/**
 * Klien API layanan token.
 *
 * Alamat backend dibaca dari `backend-url.json` di akar situs — berkas itu diperbarui
 * otomatis oleh skrip tunnel di VPS setiap kali URL tunnel berubah. Jadi situs statis
 * tidak pernah menyimpan alamat yang basi.
 *
 * Token disimpan di sessionStorage: hilang saat tab ditutup, tidak ikut ke tab lain,
 * dan tidak pernah ditulis ke localStorage.
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
async function call(path, { method = 'GET', body = null, token = '' } = {}) {
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
    });
    let data = {};
    try { data = await res.json(); } catch { /* jawaban tanpa body */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'jaringan_gagal' } };
  }
}

/** Verifikasi token untuk satu proyek. */
export function validateToken(project, token) {
  return call('/api/token/validate', { method: 'POST', body: { project }, token });
}

/** Ambil konten terkunci satu proyek. */
export function fetchLockedContent(project, token) {
  return call(`/api/project/${encodeURIComponent(project)}/locked`, { token });
}

/** Kirim permintaan akses ke sales. */
export function requestAccess(payload) {
  return call('/api/contact/sales', { method: 'POST', body: payload });
}
