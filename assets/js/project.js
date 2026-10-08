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
import { pasangMonogram } from './monogram.js';
import { projects } from './data/projects.js';
import { icon } from './icons.js';

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

/**
 * Status verifikasi Turnstile untuk form token.
 * false = tombol Buka terkunci (keadaan awal saat Turnstile aktif).
 */
let gateVerified = false;

/** Kunci tombol selama permintaan berjalan; hormati status verifikasi. */
function setBusy(busy) {
  submit.disabled = busy || !gateVerified;
  submit.textContent = busy ? 'Memeriksa…' : 'Buka';
}

// Tombol Buka terkunci sejak awal — verifikasi keamanan diperiksa lebih dulu.
// Teks tombol tetap "Buka" (bukan label status); keadaan terkunci ditandai
// gaya disabled yang jelas (lihat .gate-form .btn:disabled di project.css).
// Diaktifkan kembali setelah verifikasi berhasil, atau langsung kalau
// Turnstile memang nonaktif (lihat renderGateTurnstile).
submit.disabled = true;

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

  // Badge tier — ikon SVG, bukan emoji (konsisten di semua OS,
  // bisa diwarnai CSS, dan tidak dibaca sebagai nama emoji oleh screen reader).
  const tier = payload?.tier ?? 'standard';
  const badge = document.createElement('span');
  badge.className = `tier-badge tier-${tier}`;
  const badgeIcon = icon(tier === 'enterprise' ? 'shield' : 'lock', { size: 13 });
  if (badgeIcon) badge.append(badgeIcon);
  badge.append(document.createTextNode(tier === 'enterprise' ? 'Enterprise' : 'Gated'));
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

  // ── AKSES REPO — HANYA UNTUK PEMEGANG TOKEN ────────────────────────────────
  // Kode sumber proyek ini privat. Blok akses dikirim SERVER sebagai bagian
  // dari konten terkunci, jadi isinya tidak pernah ada di HTML maupun JS
  // halaman sebelum token lolos. Ini yang membuat token punya nilai nyata:
  // bukan sekadar membuka tulisan, tapi membuka jalan ke kode.
  //
  // CATATAN PENTING — kenapa TIDAK ada tautan repo di sini:
  // GitHub menolak akses anonim ke repo privat, jadi tautan apa pun akan
  // mendarat di 404 — bahkan untuk pemegang token. Satu-satunya mekanisme
  // yang benar-benar bekerja adalah undangan collaborator: pemegang token
  // mengirim username GitHub-nya, lalu diundang lewat GitHub.
  //
  // Kalau server tidak mengirim `repoAccess`, blok ini tidak ditampilkan
  // sama sekali — tidak ada kotak kosong atau tombol mati.
  if (content.repoAccess) {
    const a = content.repoAccess;
    const repoBox = document.createElement('div');
    repoBox.className = 'locked-repo';

    const h3 = document.createElement('h3');
    h3.textContent = a.heading || 'Akses kode sumber';

    const body = document.createElement('p');
    body.className = 'locked-repo-body';
    body.textContent = a.body || '';

    repoBox.append(h3, body);

    // Tombol hanya dirender kalau server mengirim `mailto` DAN `label`.
    // Fallback `mailto:` tanpa alamat akan membuka klien email pengguna
    // dengan tujuan kosong — pengalaman rusak yang lebih buruk daripada
    // tidak ada tombol sama sekali. Tanpa keduanya, blok tetap informatif
    // lewat `body` yang menjelaskan caranya.
    if (a.label && a.mailto) {
      const btn = document.createElement('a');
      btn.className = 'btn btn-primary';
      btn.href = a.mailto;
      btn.textContent = a.label;
      repoBox.append(btn);
    }

    if (a.note) {
      const note = document.createElement('p');
      note.className = 'locked-repo-note';
      note.textContent = a.note;
      repoBox.append(note);
    }

    contentHost.append(repoBox);
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
    // Token Turnstile sekali pakai — minta yang baru untuk sesi berikutnya,
    // dan kunci tombol lagi sampai verifikasi ulang berhasil.
    if (gateWidgetId !== null && window.turnstile?.reset) {
      gateVerified = false;
      setBusy(false);
      window.turnstile.reset(gateWidgetId);
    }
    setStatus('Sesi ditutup. Token dihapus dari peramban ini.', 'ok');
  });
  foot.append(lockBtn);
  contentHost.append(foot);
}

/** Buka konten: token → session → content. */
async function unlock(token) {
  setBusy(true);
  setStatus('Memeriksa token…');

  // Token Turnstile dari widget gerbang (kalau aktif). Server menolak
  // pembuatan sesi tanpa verifikasi manusia — lapis kedua yang tidak bisa
  // dilewati dengan mengirim request langsung.
  const turnstileToken = (gateWidgetId !== null && window.turnstile?.getResponse)
    ? (window.turnstile.getResponse(gateWidgetId) ?? '')
    : '';

  // Step 1: Buat session cookie
  const sess = await createSession(token, PROJECT, { 'cf-turnstile-response': turnstileToken });
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

  // Lapis pertama (klien): jangan izinkan kirim sebelum verifikasi berhasil.
  // Lapis kedua (server) tetap memeriksa — ini mencegah percobaan sia-sia.
  if (gateWidgetId !== null && !gateVerified) {
    setStatus('Selesaikan verifikasi keamanan dulu.', 'error');
    return;
  }

  // Token dinormalkan ke huruf besar: alfabet token hanya A–Z dan 2–9,
  // jadi pengunjung yang mengetik huruf kecil tetap bisa membuka.
  const token = input.value.trim().toUpperCase();
  if (!token) {
    setStatus('Masukkan token akses Anda terlebih dahulu.', 'error');
    input.focus();
    return;
  }

  // Format token: VP-XXXX-XXXX-XXXX-XXXX (4 segmen × 4 karakter base32).
  // Dicek di klien supaya salah ketik ketahuan sebelum request dikirim —
  // server tetap memeriksa ulang, ini hanya mempercepat umpan balik.
  if (!/^VP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(token)) {
    setStatus('Format token tidak sesuai. Contoh: VP-XXXX-XXXX-XXXX-XXXX.', 'error');
    input.focus();
    return;
  }

  // Track: token attempt
  trackEvent('token_attempt', PROJECT);

  const ok = await unlock(token);

  // Token Turnstile sekali pakai — reset supaya percobaan berikutnya
  // mendapat token baru (kalau tidak, server menolak "timeout-or-duplicate").
  if (gateWidgetId !== null && window.turnstile?.reset) {
    gateVerified = false;
    setBusy(false);
    window.turnstile.reset(gateWidgetId);
  }

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

  // Render widget Turnstile saat form pertama dibuka (lazy). Tombol Kirim
  // terkunci sampai verifikasi berhasil. Kalau site key tidak tersedia,
  // slot tetap tersembunyi dan form jalan tanpa Turnstile.
  renderRequestTurnstile();

  // Track: contact sales clicked
  trackEvent('contact_sales', PROJECT);
});

// ── Cloudflare Turnstile ──────────────────────────────────────────────────────
// Dua widget, dua gerbang:
//   1. #gateTurnstile  — form token akses. Tombol "Buka" TERKUNCI sampai
//      verifikasi berhasil. Token ikut dikirim saat membuat sesi; server
//      menolak sesi tanpa verifikasi (lapis kedua — tidak bisa dilewati
//      dengan mematikan JavaScript atau mengirim request langsung).
//   2. #turnstileSlot  — form permintaan akses. Tombol "Kirim permintaan"
//      terkunci sampai verifikasi berhasil.
//
// Site key diambil dari backend (/api/config) — menyalakan/mematikan
// Turnstile cukup lewat service.env, tanpa menyentuh frontend.
// Kalau Turnstile nonaktif, tombol langsung aktif dan form jalan seperti biasa.

let gateWidgetId = null;
let requestWidgetId = null;
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

/** Tunggu library Turnstile (dimuat async) siap dipakai. */
function waitForTurnstile(cb, tries = 60) {
  if (window.turnstile?.render) { cb(); return; }
  if (tries <= 0) return;
  setTimeout(() => waitForTurnstile(cb, tries - 1), 250);
}

/** Widget gerbang token: tombol Buka terkunci sampai verifikasi berhasil. */
async function renderGateTurnstile() {
  const slot = $('#gateTurnstile');
  if (!slot || gateWidgetId !== null) return;

  const cfg = await loadTurnstileConfig();
  if (!cfg.enabled || !cfg.site_key) {
    // Turnstile nonaktif — jangan blokir pengunjung.
    gateVerified = true;
    setBusy(false);
    return;
  }

  waitForTurnstile(() => {
    slot.hidden = false;
    try {
      gateWidgetId = window.turnstile.render(slot, {
        sitekey: cfg.site_key,
        theme: 'dark',
        action: 'token_gate',
        callback: () => {
          gateVerified = true;
          setBusy(false);
          // Tidak ada pesan sukses. Widget Turnstile sendiri sudah
          // menampilkan centang hijau, dan tombol berubah dari redup
          // menjadi aktif — indikator yang cukup. Pesan tambahan hanya
          // menambah noise di alur produksi.
          setStatus('');
        },
        'expired-callback': () => {
          gateVerified = false;
          setBusy(false);
          setStatus('Verifikasi kedaluwarsa. Selesaikan ulang untuk melanjutkan.', 'error');
        },
        'error-callback': () => {
          gateVerified = false;
          setBusy(false);
          setStatus('Verifikasi keamanan bermasalah. Muat ulang halaman.', 'error');
        },
      });
    } catch {
      setStatus('Verifikasi keamanan bermasalah. Muat ulang halaman.', 'error');
    }
  });

  // Kalau library tidak kunjung termuat (adblock/jaringan), beri tahu
  // pengunjung. Tombol tetap terkunci — server memang menolak tanpa
  // verifikasi, jadi membiarkannya terbuka hanya membuang percobaan.
  setTimeout(() => {
    if (gateWidgetId === null && !gateVerified) {
      setStatus('Verifikasi keamanan tidak dapat dimuat. Muat ulang halaman atau matikan pemblokir.', 'error');
    }
  }, 15000);
}

/** Widget form permintaan: tombol Kirim terkunci sampai verifikasi berhasil. */
async function renderRequestTurnstile() {
  const slot = $('#turnstileSlot');
  if (!slot || requestWidgetId !== null) return;

  const cfg = await loadTurnstileConfig();
  if (!cfg.enabled || !cfg.site_key) return; // form jalan tanpa Turnstile

  const button = $('#requestSubmit');
  button.disabled = true; // aktif setelah verifikasi berhasil

  waitForTurnstile(() => {
    slot.hidden = false;
    requestWidgetId = window.turnstile.render(slot, {
      sitekey: cfg.site_key,
      theme: 'dark',
      action: 'lead_form',
      // Kalau token kedaluwarsa (pengunjung lama mengisi), perbarui otomatis
      // supaya tidak perlu muat ulang halaman.
      'refresh-expired': 'auto',
      callback: () => { button.disabled = false; },
      'expired-callback': () => { button.disabled = true; },
      'error-callback': () => { button.disabled = true; },
    });
  });
}

// ── Validasi form permintaan ──────────────────────────────────────────────────
// Pesan berbahasa Indonesia yang spesifik, bukan bawaan peramban
// ("Harap isi bidang ini") — form pakai novalidate supaya peramban tidak
// menampilkan balon pesan bawaannya; validasi kita yang berbicara.

/** Aturan validasi per field. Urutan = urutan fokus saat gagal. */

/** Nama orang: minimal 3 huruf, harus ada huruf, tidak boleh angka/simbol. */
function validPersonName(v) {
  const s = v.trim();
  if (s.length < 3) return false;
  if (/\d/.test(s)) return false;                    // nama tidak berisi angka
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return false;          // harus ada huruf
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .-]*$/.test(s)) return false; // hanya huruf, spasi, ' . -
  return true;
}

/** Nama perusahaan: minimal 3 karakter, harus ada huruf, boleh angka & simbol legal. */
function validCompanyName(v) {
  const s = v.trim();
  if (s.length < 3) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return false;          // harus ada huruf
  if (!/^[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9&' .,()\-]*$/.test(s)) return false;
  return true;
}

const FIELD_RULES = [
  { id: 'reqCompany', errId: 'errCompany', name: 'Perusahaan',
    test: validCompanyName,
    message: 'Masukkan nama perusahaan yang valid (minimal 3 karakter, harus ada huruf).' },
  { id: 'reqName', errId: 'errName', name: 'Nama',
    test: validPersonName,
    message: 'Masukkan nama lengkap Anda (minimal 3 karakter, tanpa angka).' },
  { id: 'reqEmail', errId: 'errEmail', name: 'Email',
    test: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()),
    message: 'Masukkan alamat email kerja yang valid, misalnya nama@perusahaan.co.id.' },
  { id: 'reqBudget', errId: 'errBudget', name: 'Kisaran budget',
    test: (v) => v !== '', message: 'Pilih kisaran budget supaya permintaan bisa ditinjau dengan tepat.' },
  { id: 'reqUrgency', errId: 'errUrgency', name: 'Urgensi',
    test: (v) => v !== '', message: 'Pilih urgensi kebutuhan Anda.' },
  { id: 'reqMessage', errId: 'errMessage', name: 'Keperluan',
    test: (v) => v.trim().length >= 10, message: 'Jelaskan keperluan Anda (minimal 10 karakter).' },
];

/** Tampilkan pesan error di bawah field + tandai field. */
function setFieldError(field, errId, message) {
  const err = document.getElementById(errId);
  const wrap = field.closest('.field');
  if (message) {
    if (err) err.textContent = message;
    wrap?.classList.add('is-invalid');
    field.setAttribute('aria-invalid', 'true');
  } else {
    if (err) err.textContent = '';
    wrap?.classList.remove('is-invalid');
    field.removeAttribute('aria-invalid');
  }
}

/** Bersihkan semua error. */
function clearFieldErrors() {
  for (const rule of FIELD_RULES) {
    const field = document.getElementById(rule.id);
    if (field) setFieldError(field, rule.errId, '');
  }
}

/**
 * Validasi seluruh form. Mengembalikan data form kalau valid, atau null
 * (sekaligus menampilkan error di field pertama yang bermasalah).
 */
function validateRequestForm() {
  clearFieldErrors();
  let firstInvalid = null;

  for (const rule of FIELD_RULES) {
    const field = document.getElementById(rule.id);
    if (!field) continue;
    if (!rule.test(field.value)) {
      setFieldError(field, rule.errId, rule.message);
      if (!firstInvalid) firstInvalid = field;
    }
  }

  if (firstInvalid) {
    firstInvalid.focus();
    firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return null;
  }
  return Object.fromEntries(new FormData(requestForm).entries());
}

// Error hilang begitu pengunjung memperbaiki field-nya.
for (const rule of FIELD_RULES) {
  const field = document.getElementById(rule.id);
  if (!field) continue;
  const event = field.tagName === 'SELECT' ? 'change' : 'input';
  field.addEventListener(event, () => {
    if (rule.test(field.value)) setFieldError(field, rule.errId, '');
  });
}

$('#requestCancel').addEventListener('click', () => {
  requestSection.hidden = true;
  requestStatus.textContent = '';
  clearFieldErrors();
});

requestForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  // Validasi dulu — pesan spesifik per field, fokus ke yang pertama salah.
  const data = validateRequestForm();
  if (!data) return;

  const email = String(data.email ?? '').trim();

  // Hitung berapa lama form diisi. Backend memakai angka ini untuk menilai
  // apakah pengisian terlalu cepat (ciri bot). Dikirim sebagai elapsed_ms.
  const startedAt = Number($('#reqStartedAt')?.value ?? 0);
  const elapsedMs = startedAt > 0 ? Date.now() - startedAt : null;

  // Token Turnstile (kalau widget aktif). Dikirim sebagai
  // cf-turnstile-response — nama field yang diharapkan Cloudflare.
  const turnstileToken = (requestWidgetId !== null && window.turnstile?.getResponse)
    ? (window.turnstile.getResponse(requestWidgetId) ?? '')
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

  // Token Turnstile sekali pakai — reset supaya percobaan berikutnya
  // mendapat token baru.
  if (requestWidgetId !== null && window.turnstile?.reset) {
    window.turnstile.reset(requestWidgetId);
  }

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

  // Gerbang verifikasi untuk form token: tombol Buka terkunci sampai
  // verifikasi berhasil. Kalau konten sudah terbuka (sesi aktif), widget
  // tidak perlu dirender.
  if (contentHost.hidden) renderGateTurnstile();

  // Micro-interactions Astra — setelah konten statis siap.
  initAstra();

  // Logo interaktif — simbol coding yang bergerak saat hover/klik.
  pasangMonogram();
})();
