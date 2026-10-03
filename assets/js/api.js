/**
 * Klien API layanan token.
 *
 * Alamat backend dibaca dari `backend-url.json` di akar situs — berkas itu diperbarui
 * otomatis oleh skrip tunnel di VPS setiap kali URL tunnel berubah. Jadi situs statis
 * tidak pernah menyimpan alamat yang basi.
 *
 * Flow baru (v2.1):
 *   1. User submit token → POST /api/token/session → server set httpOnly cookie
 *   2. Cookie 'portfolio_session' ikut otomatis di request berikutnya
 *   3. Konten diambil via GET /api/project/:slug/locked (cookie-based)
 *   4. Logout → POST /api/token/logout → cookie dihapus
 *
 * credentials: 'include' wajib supaya cookie cross-origin terkirim.
 */

const URL_FILE = '/backend-url.json';
const STORAGE_KEY = 'portfolio.token';

let cachedBase = null;

/** Alamat dasar API, atau null kalau belum bisa dibaca. */
export async function apiBase() {
  if (cachedBase) return cachedBase;
  try {
    const res = await fetch(URL_FILE, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const base = typeof data?.api_base === 'string' ? data.api_base.replace(/\/$/, '') : null;
    cachedBase = base;
    return base;
  } catch {
    return null;
  }
}

/** Token yang tersimpan di sesi ini (atau string kosong). */
export function storedToken() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return ''; // mode privasi ketat bisa memblokir sessionStorage
  }
}

/** Simpan token untuk sesi ini. */
export function storeToken(token) {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* gagal menyimpan bukan alasan untuk menghentikan alur */
  }
}

/** Hapus token dari sesi ini. */
export function clearToken() {
  storeToken('');
}

/** Panggil endpoint API. Mengembalikan { ok, status, data }. */
async function call(path, { method = 'GET', body = null, token = '', useCredentials = false } = {}) {
  const base = await apiBase();
  if (!base) return { ok: false, status: 0, data: { error: 'backend_tidak_diketahui' } };

  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers['x-project-token'] = token;

  try {
    const res = await fetch(base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      mode: 'cors',
      credentials: useCredentials ? 'include' : 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* jawaban tanpa body */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'jaringan_gagal' } };
  }
}

/**
 * Tukar token dengan session cookie.
 * Kalau berhasil, server set httpOnly cookie 'portfolio_session'.
 *
 * `extra` dipakai untuk membawa token Turnstile (cf-turnstile-response) —
 * server menolak pembuatan sesi tanpa verifikasi manusia saat Turnstile aktif.
 */
export function createSession(token, project, extra = {}) {
  return call('/api/token/session', {
    method: 'POST',
    body: { token, project, ...extra },
    useCredentials: true,
  });
}

/**
 * Logout — hapus session cookie.
 */
export function destroySession() {
  return call('/api/token/logout', {
    method: 'POST',
    useCredentials: true,
  });
}

/**
 * Ambil konten terkunci satu proyek (session cookie otomatis terkirim).
 */
export function fetchLockedContent(project) {
  return call(`/api/project/${encodeURIComponent(project)}/locked`, {
    useCredentials: true,
  });
}

/** Verifikasi token untuk satu proyek (tanpa buat session). */
export function validateToken(project, token) {
  return call('/api/token/validate', { method: 'POST', body: { project }, token });
}

/** Kirim permintaan akses ke sales. */
export function requestAccess(payload) {
  return call('/api/contact/sales', { method: 'POST', body: payload });
}

/**
 * Track analytics event dari frontend.
 * Fire-and-forget: tidak menunggu respons, tidak mengganggu UX.
 */
export function trackEvent(eventType, project, metadata = {}) {
  // Fire-and-forget: jangan await, jangan blocking
  call('/api/analytics/track', {
    method: 'POST',
    body: { event_type: eventType, project, metadata },
    useCredentials: false, // no cookie needed for tracking
  }).catch(() => { /* silently fail */ });
}
