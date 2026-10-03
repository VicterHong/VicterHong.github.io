/**
 * Penjaga spam untuk form publik (lead sales).
 *
 * Menutup pertanyaan terbuka Q3 di PRD: "Apakah perlu CAPTCHA pada form sales?"
 *
 * KEPUTUSAN: tidak pakai CAPTCHA. Alasan:
 *   1. CAPTCHA menambah dependensi pihak ketiga (Google reCAPTCHA) — bertentangan
 *      dengan prinsip "tidak ada pelacakan pihak ketiga" (F6) dan "privasi:
 *      audit log disimpan di VPS sendiri".
 *   2. CAPTCHA pihak ketiga mengirim data pengunjung ke layanan luar — calon
 *      klien enterprise bisa keberatan.
 *   3. CAPTCHA punya biaya UX: menambah gesekan tepat di titik konversi paling
 *      penting (form permintaan akses).
 *
 * SEBAGAI GANTINYA: penapisan berlapis tanpa pihak ketiga.
 *   Lapis 1 — honeypot: field tersembunyi yang hanya diisi bot.
 *   Lapis 2 — waktu isi: bot mengirim terlalu cepat; manusia butuh beberapa detik.
 *   Lapis 3 — batas laju per-IP (sudah ada di rate-limit.mjs).
 *   Lapis 4 — heuristik isi: tautan berlebihan, kata kunci spam, email sekali-pakai.
 *
 * Hasilnya: bot disaring tanpa satu pun request ke layanan luar, dan pengunjung
 * sungguhan tidak melihat apa pun.
 */

/**
 * Domain email sekali-pakai yang sering dipakai spam.
 * Bukan daftar lengkap — hanya yang paling sering muncul di log.
 * Lead dari domain ini tetap DITERIMA tapi ditandai untuk ditinjau manual,
 * karena sebagian orang sah memakai email pribadi.
 */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'throwawaymail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com',
  'maildrop.cc', 'getnada.com', 'temp-mail.org', 'fakeinbox.com',
]);

/** Kata kunci yang hampir selalu berarti spam. */
const SPAM_KEYWORDS = [
  'seo services', 'buy backlinks', 'crypto investment', 'bitcoin doubler',
  'viagra', 'casino online', 'slot gacor', 'pinjaman online', 'judi online',
  'guest post', 'link building service', 'bulk email',
];

/** Jumlah minimum detik yang wajar untuk mengisi form. */
const MIN_FILL_SECONDS = 3;

/** Jumlah maksimum tautan yang wajar dalam pesan. */
const MAX_LINKS = 3;

/**
 * Nilai skor risiko untuk sebuah lead.
 *
 * Mengembalikan { score, reasons, verdict }:
 *   verdict 'allow'  → simpan seperti biasa
 *   verdict 'review' → simpan, tapi tandai untuk ditinjau manual
 *   verdict 'block'  → jangan simpan, balas seolah berhasil (bot tidak belajar)
 *
 * @param {object} input
 * @param {object} input.body      isi form mentah
 * @param {string} input.ip        alamat IP pengirim
 * @param {string} input.userAgent user-agent pengirim
 * @returns {{score: number, reasons: string[], verdict: 'allow'|'review'|'block'}}
 */
export function scoreLead({ body = {}, ip = '', userAgent = '' } = {}) {
  let score = 0;
  const reasons = [];

  // ── Lapis 1: honeypot ──────────────────────────────────────────────────────
  // Field ini tersembunyi lewat CSS di halaman. Manusia tidak melihatnya,
  // jadi tidak akan mengisinya. Bot yang membaca HTML akan mengisinya.
  if (String(body.website ?? '').trim() !== '') {
    score += 100;
    reasons.push('honeypot terisi');
  }

  // ── Lapis 2: waktu isi ─────────────────────────────────────────────────────
  // Halaman mengirim `elapsed_ms` = waktu dari form tampil sampai dikirim.
  // Bot mengirim dalam milidetik; manusia butuh detik.
  const elapsed = Number(body.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed >= 0) {
    if (elapsed < MIN_FILL_SECONDS * 1000) {
      score += 40;
      reasons.push(`form terisi terlalu cepat (${Math.round(elapsed)} ms)`);
    }
  }

  // ── Lapis 4: heuristik isi ─────────────────────────────────────────────────
  const email = String(body.email ?? '').trim().toLowerCase();
  const message = String(body.message ?? '');
  const company = String(body.company ?? '');
  const name = String(body.name ?? '');

  // Email sekali-pakai
  const domain = email.split('@')[1] ?? '';
  if (DISPOSABLE_DOMAINS.has(domain)) {
    score += 25;
    reasons.push(`domain email sekali-pakai (${domain})`);
  }

  // Tautan berlebihan dalam pesan
  const linkCount = (message.match(/https?:\/\//gi) ?? []).length;
  if (linkCount > MAX_LINKS) {
    score += 30;
    reasons.push(`terlalu banyak tautan (${linkCount})`);
  }

  // Kata kunci spam
  const haystack = `${message} ${company} ${name}`.toLowerCase();
  for (const kw of SPAM_KEYWORDS) {
    if (haystack.includes(kw)) {
      score += 50;
      reasons.push(`kata kunci spam: "${kw}"`);
      break;
    }
  }

  // Nama perusahaan berisi tautan (ciri spam)
  if (/https?:\/\//i.test(company)) {
    score += 30;
    reasons.push('nama perusahaan berisi tautan');
  }

  // Huruf non-latin berlebihan di nama (ciri bot)
  const cyrillic = (name.match(/[\u0400-\u04FF]/g) ?? []).length;
  if (name.length > 0 && cyrillic / name.length > 0.5) {
    score += 20;
    reasons.push('nama didominasi huruf non-latin');
  }

  // User-agent kosong atau jelas bot
  const ua = String(userAgent ?? '').toLowerCase();
  if (!ua || ua.includes('curl') || ua.includes('python-requests') || ua.includes('bot')) {
    score += 15;
    reasons.push('user-agent mencurigakan');
  }

  const verdict = score >= 100 ? 'block' : score >= 25 ? 'review' : 'allow';
  return { score, reasons, verdict };
}

/**
 * Apakah IP ini sudah mengirim terlalu banyak lead dalam jendela waktu.
 * Dipakai bersama rate-limit.mjs untuk mencegah satu IP membanjiri daftar lead.
 *
 * @param {Array<{ip: string, created_at: string}>} recentLeads lead terbaru dari DB
 * @param {string} ip alamat IP yang diperiksa
 * @param {number} windowMs jendela waktu dalam milidetik
 * @param {number} max jumlah maksimum dalam jendela
 */
export function tooManyLeadsFromIp(recentLeads, ip, windowMs = 3600_000, max = 3) {
  if (!ip) return false;
  const cutoff = Date.now() - windowMs;
  const count = recentLeads.filter(
    (l) => l.ip === ip && new Date(l.created_at).getTime() > cutoff,
  ).length;
  return count >= max;
}
