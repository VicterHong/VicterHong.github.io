/**
 * Siapkan domain email profesional di victer.is-a.dev lewat Resend + is-a.dev.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── MASALAH YANG DIPECAHKAN SKRIP INI ────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `victer.is-a.dev` sudah dipakai situs lewat CNAME. DNS melarang CNAME
 * digabung dengan record lain (MX, TXT) — jadi email TIDAK BISA dipasang
 * langsung di root domain.
 *
 * Solusinya: SUBDOMAIN KHUSUS EMAIL. Pola ini sudah dipakai di repo is-a.dev:
 *
 *   domains/send.victer.json              → MX (penerimaan balasan) + SPF
 *   domains/resend._domainkey.victer.json → DKIM (tanda tangan pengirim)
 *
 * Hasilnya: alamat pengirim `noreply@send.victer.is-a.dev` — profesional,
 * gratis, dan situs tidak terganggu sama sekali.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── YANG DILAKUKAN SKRIP INI (otomatis) ──────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1. Baca RESEND_API_KEY dari service.env
 *   2. Tambah domain `send.victer.is-a.dev` ke akun Resend
 *   3. Ambil record DNS yang Resend minta (DKIM + SPF + MX)
 *   4. Tulis dua berkas JSON untuk repo is-a.dev
 *   5. Commit + push ke fork
 *   6. Buat pull request ke is-a.dev/register
 *
 * Setelah PR di-merge, jalankan `--verifikasi` untuk memicu Resend memeriksa
 * DNS dan menandai domain siap.
 *
 * ── PAKAI ────────────────────────────────────────────────────────────────────
 *   node scripts/setup-domain-email.mjs --siapkan
 *   node scripts/setup-domain-email.mjs --verifikasi
 *   node scripts/setup-domain-email.mjs --status
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DOMAIN_EMAIL = 'send.victer.is-a.dev';       // subdomain pengiriman (Resend)
const DOMAIN_BREVO = 'victer.is-a.dev';            // domain untuk Brevo DKIM
const DOMAIN_AKAR = 'victer.is-a.dev';             // root (situs, CNAME)
const FORK = 'VicterHong/register';
const REPO_UPSTREAM = 'is-a-dev/register';
const CLONE_DIR = '/tmp/is-a-dev-register';

// ── Kunci API ─────────────────────────────────────────────────────────────────

/** Baca RESEND_API_KEY dari service.env (atau lingkungan). */
function kunciResend() {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY.trim();

  const berkas = process.env.TOKEN_SERVICE_ENV
    ?? join(process.env.HOME ?? '/home/ubuntu', '.portfolio-token', 'service.env');

  if (!existsSync(berkas)) return null;

  for (const baris of readFileSync(berkas, 'utf8').split('\n')) {
    const cocok = baris.match(/^\s*RESEND_API_KEY\s*=\s*(.+?)\s*$/);
    if (cocok) return cocok[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

async function resend(jalur, opsi = {}) {
  const kunci = kunciResend();
  if (!kunci) throw new Error('RESEND_API_KEY belum diisi di service.env');

  const res = await fetch(`https://api.resend.com${jalur}`, {
    ...opsi,
    headers: {
      Authorization: `Bearer ${kunci}`,
      'Content-Type': 'application/json',
      ...(opsi.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });

  const teks = await res.text();
  let data;
  try { data = JSON.parse(teks); } catch { data = { mentah: teks }; }

  if (!res.ok) {
    const pesan = data?.message ?? data?.error?.message ?? teks.slice(0, 200);
    throw new Error(`Resend ${res.status}: ${pesan}`);
  }
  return data;
}

// ── Brevo ─────────────────────────────────────────────────────────────────────
//
// ── KENAPA BREVO, BUKAN RESEND ──────────────────────────────────────────────
// Resend MENOLAK `is-a.dev` dengan pesan:
//
//   "We don't allow free public domains. Please use a domain you own instead."
//
// Penyebabnya: `is-a.dev` terdaftar di Public Suffix List, sehingga Resend
// menganggapnya domain publik — bukan soal kepemilikan, tapi kebijakan
// anti-abuse mereka.
//
// Brevo menerimanya. Terbukti dari repo is-a.dev: beberapa domain memakai
// Brevo DKIM (`brevo1._domainkey.<domain>` → CNAME `b1.<domain>-is-a-dev.dkim.brevo.com`)
// dan PR-nya di-merge — terbaru 2026-10-05.

function kunciBrevo() {
  if (process.env.BREVO_API_KEY) return process.env.BREVO_API_KEY.trim();

  const berkas = process.env.TOKEN_SERVICE_ENV
    ?? join(process.env.HOME ?? '/home/ubuntu', '.portfolio-token', 'service.env');

  if (!existsSync(berkas)) return null;

  for (const baris of readFileSync(berkas, 'utf8').split('\n')) {
    const cocok = baris.match(/^\s*BREVO_API_KEY\s*=\s*(.+?)\s*$/);
    if (cocok) return cocok[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

async function brevo(jalur, opsi = {}) {
  const kunci = kunciBrevo();
  if (!kunci) throw new Error('BREVO_API_KEY belum diisi di service.env');

  const res = await fetch(`https://api.brevo.com/v3${jalur}`, {
    ...opsi,
    headers: {
      'api-key': kunci,           // BUKAN Authorization: Bearer
      'Content-Type': 'application/json',
      accept: 'application/json',
      ...(opsi.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });

  const teks = await res.text();
  let data;
  try { data = teks ? JSON.parse(teks) : {}; } catch { data = { mentah: teks }; }

  if (!res.ok) {
    const pesan = data?.message ?? data?.error ?? teks.slice(0, 200);
    throw new Error(`Brevo ${res.status}: ${pesan}`);
  }
  return data;
}

// ── Perintah: status ──────────────────────────────────────────────────────────

async function status() {
  console.log('');
  console.log('  ── STATUS DOMAIN EMAIL ─────────────────────────────────────');
  console.log(`     Domain email  : ${DOMAIN_EMAIL}`);
  console.log(`     Domain situs  : ${DOMAIN_AKAR} (CNAME — tidak bisa dicampur MX)`);
  console.log('');

  if (!kunciResend()) {
    console.log('  ❌ RESEND_API_KEY belum diisi.');
    console.log('');
    console.log('  Langkah pertama:');
    console.log('    1. Daftar gratis di https://resend.com');
    console.log('    2. Buka https://resend.com/api-keys → Create API Key');
    console.log('    3. Tambahkan ke ~/.portfolio-token/service.env:');
    console.log('         RESEND_API_KEY=re_xxxxxxxxxxxx');
    console.log('');
    return 1;
  }

  try {
    const hasil = await resend('/domains');
    const daftar = hasil?.data ?? [];

    console.log(`  ✅ Kunci API aktif — ${daftar.length} domain terdaftar di Resend:`);
    console.log('');

    if (daftar.length === 0) {
      console.log('     (belum ada domain)');
    }

    for (const d of daftar) {
      const tanda = d.status === 'verified' ? '✅' : d.status === 'pending' ? '⏳' : '❌';
      console.log(`     ${tanda} ${d.name}  [${d.status}]`);
    }
    console.log('');

    const target = daftar.find((d) => d.name === DOMAIN_EMAIL);
    if (target) {
      console.log(`  ── DOMAIN TARGET: ${DOMAIN_EMAIL} ──`);
      console.log(`     Status: ${target.status}`);
      if (target.status !== 'verified') {
        console.log('     Jalankan --verifikasi setelah PR is-a.dev di-merge.');
      }
    } else {
      console.log(`  ℹ️  ${DOMAIN_EMAIL} belum ditambahkan — jalankan --siapkan`);
    }
    console.log('');
    return 0;

  } catch (e) {
    console.error(`  ❌ ${e.message}`);
    console.log('');
    return 1;
  }
}

// ── Perintah: siapkan ─────────────────────────────────────────────────────────

async function siapkan() {
  console.log('');
  console.log('  ══ MENYIAPKAN DOMAIN EMAIL ══');
  console.log('');

  // ── PEMILIHAN PENYEDIA ─────────────────────────────────────────────────────
  //
  // Brevo diperiksa DULU karena ia menerima domain dari Public Suffix List.
  // Resend MENOLAK `is-a.dev` — sudah dibuktikan dengan uji langsung:
  //
  //   victer.is-a.dev         → ❌ "We don't allow free public domains"
  //   mail.victer.is-a.dev    → ❌ idem
  //   send.victer.is-a.dev    → ❌ idem
  //
  // Jadi kalau hanya ada kunci Resend, skrip ini berhenti dengan penjelasan
  // — bukan gagal dengan pesan mentah dari API.
  const pakaiBrevo = Boolean(kunciBrevo());

  if (!pakaiBrevo && !kunciResend()) {
    console.error('  ❌ Belum ada kunci penyedia email.');
    console.log('');
    console.log('  ── BREVO (disarankan — menerima is-a.dev) ──');
    console.log('    1. Daftar gratis di https://brevo.com (9.000 email/bulan)');
    console.log('    2. Buka https://app.brevo.com/settings/keys/api → Create');
    console.log('    3. Tambahkan ke ~/.portfolio-token/service.env:');
    console.log('         BREVO_API_KEY=xkeysib-xxxxxxxxxxxx');
    console.log('         BREVO_SENDER_EMAIL=noreply@victer.is-a.dev');
    console.log('');
    console.log('  ── RESEND (TIDAK bisa untuk is-a.dev) ──');
    console.log('    Resend menolak domain dari Public Suffix List, termasuk is-a.dev.');
    console.log('    Pakai Brevo, atau daftarkan domain berbayar sendiri.');
    console.log('');
    return 1;
  }

  if (!pakaiBrevo) {
    console.log('  ⚠️  Hanya ada RESEND_API_KEY — dan Resend MENOLAK is-a.dev.');
    console.log('');
    console.log('  Alasan: is-a.dev terdaftar di Public Suffix List, sehingga Resend');
    console.log('  menganggapnya "free public domain". Sudah diuji langsung:');
    console.log('    victer.is-a.dev / mail. / send. / notif. → semua ditolak');
    console.log('');
    console.log('  Solusi: pakai BREVO (gratis, 9.000 email/bulan, menerima is-a.dev).');
    console.log('    1. https://brevo.com → daftar');
    console.log('    2. https://app.brevo.com/settings/keys/api → Create API Key');
    console.log('    3. Tambahkan ke ~/.portfolio-token/service.env:');
    console.log('         BREVO_API_KEY=xkeysib-xxxxxxxxxxxx');
    console.log('');
    return 1;
  }

  console.log('  Penyedia: BREVO (menerima domain is-a.dev)');
  console.log('');

  // ── 1. Tambah domain ke Brevo ──────────────────────────────────────────────
  console.log(`  1. Menambahkan ${DOMAIN_BREVO} ke Brevo...`);

  let domain;
  try {
    const ada = await brevo('/senders/domains');
    domain = (ada?.domains ?? []).find((d) => d.domain_name === DOMAIN_BREVO);

    if (domain) {
      console.log(`     ℹ️  sudah ada (verified: ${domain.verified})`);
    } else {
      domain = await brevo('/senders/domains', {
        method: 'POST',
        body: JSON.stringify({ name: DOMAIN_BREVO }),
      });
      console.log('     ✅ ditambahkan');
    }
  } catch (e) {
    console.error(`     ❌ ${e.message}`);
    return 1;
  }

  // ── 2. Ambil record DNS ────────────────────────────────────────────────────
  //
  // ── KENAPA HARUS ENDPOINT DETAIL, BUKAN DAFTAR ─────────────────────────────
  // `GET /senders/domains` (daftar) mengembalikan `records: null` — record DNS
  // baru muncul di `GET /senders/domains/{domain}` (detail).
  //
  // Dan nama field-nya TIDAK konsisten antara dokumentasi dan kenyataan:
  //   • Dokumentasi menyebut `dkim_record`
  //   • Kenyataan: `dkim1Record` + `dkim2Record` (camelCase, bernomor)
  //
  // Skrip ini membaca KEDUANYA supaya tetap bekerja kalau Brevo mengubah
  // bentuknya nanti.
  console.log('');
  console.log('  2. Mengambil record DNS yang diminta Brevo...');

  let dnsBrevo;
  try {
    dnsBrevo = await brevo(`/senders/domains/${DOMAIN_BREVO}`);
  } catch (e) {
    console.error(`     ❌ ${e.message}`);
    return 1;
  }

  const dns = dnsBrevo?.dns_records ?? {};

  // Terima dua bentuk penamaan.
  const dkim1 = dns.dkim1Record ?? dns.dkim_record;
  const dkim2 = dns.dkim2Record ?? dns.dkim_record_2;
  const dmarc = dns.dmarc_record;

  console.log(`     DKIM 1 : ${dkim1 ? `${dkim1.host_name} → ${String(dkim1.value).slice(0, 45)}…` : '❌ tidak ada'}`);
  console.log(`     DKIM 2 : ${dkim2 ? `${dkim2.host_name} → ${String(dkim2.value).slice(0, 45)}…` : '❌ tidak ada'}`);
  console.log(`     DMARC  : ${dmarc ? String(dmarc.value).slice(0, 50) : '❌ tidak ada'}`);

  if (!dkim1 || !dkim2) {
    console.error('');
    console.error('     ❌ Record DKIM belum tersedia dari Brevo.');
    console.error('        Coba lagi beberapa detik kemudian — Brevo kadang butuh waktu.');
    return 1;
  }

  // ── 3. Susun berkas untuk repo is-a.dev ────────────────────────────────────
  //
  // ── BENTUK KHUSUS BREVO (dari repo is-a.dev yang sudah merged) ─────────────
  //
  //   brevo1._domainkey.<domain>  → CNAME b1.<domain>-is-a-dev.dkim.brevo.com
  //   brevo2._domainkey.<domain>  → CNAME b2.<domain>-is-a-dev.dkim.brevo.com
  //   _dmarc.<domain>             → TXT v=DMARC1; p=none;
  //
  // Brevo memakai CNAME, BUKAN TXT — jadi TIDAK bentrok dengan CNAME situs
  // di root domain. Inilah kenapa Brevo bisa bekerja di is-a.dev sementara
  // Resend (yang butuh MX/TXT di root) tidak.
  console.log('');
  console.log('  3. Menyusun berkas is-a.dev...');

  const PEMILIK = { username: 'VicterHong', email: 'victerphanjaya@gmail.com' };

  // Nama host dari Brevo berbentuk "b1.victer-is-a-dev.dkim.brevo.com".
  const target1 = String(dkim1.value).replace(/\.$/, '');
  const target2 = String(dkim2.value).replace(/\.$/, '');

  const berkasDkim1 = {
    owner: PEMILIK,
    description: `Brevo DKIM record 1 for ${DOMAIN_AKAR}`,
    records: { CNAME: target1 },
  };

  const berkasDkim2 = {
    owner: PEMILIK,
    description: `Brevo DKIM record 2 for ${DOMAIN_AKAR}`,
    records: { CNAME: target2 },
  };

  const berkasDmarc = {
    owner: PEMILIK,
    description: `DMARC policy for ${DOMAIN_AKAR}`,
    // Nilai dari Brevo (memuat alamat laporan rua@dmarc.brevo.com) — lebih baik
    // dari nilai generik, karena Brevo bisa mengirim laporan pelanggaran.
    records: { TXT: [String(dmarc?.value ?? 'v=DMARC1; p=none;').replace(/^"|"$/g, '')] },
  };

  const keluaran = join(ROOT, '.email-domain');
  mkdirSync(keluaran, { recursive: true });

  const berkasSemua = [
    ['brevo1._domainkey.victer.json', berkasDkim1],
    ['brevo2._domainkey.victer.json', berkasDkim2],
    ['_dmarc.victer.json', berkasDmarc],
  ];

  for (const [nama, isi] of berkasSemua) {
    const jalur = join(keluaran, nama);
    writeFileSync(jalur, JSON.stringify(isi, null, 2) + '\n', 'utf8');
    console.log(`     ✅ ${nama}`);
  }

  // ── 4. Salin ke clone repo is-a.dev + commit + push ────────────────────────
  console.log('');
  console.log('  4. Menyalin ke fork is-a.dev...');

  try {
    if (!existsSync(CLONE_DIR)) {
      execFileSync('gh', ['repo', 'clone', FORK, CLONE_DIR, '--', '--depth', '1'], { stdio: 'pipe' });
      console.log('     ✅ fork di-clone');
    } else {
      execFileSync('git', ['-C', CLONE_DIR, 'fetch', 'origin'], { stdio: 'pipe' });
      execFileSync('git', ['-C', CLONE_DIR, 'reset', '--hard', 'origin/main'], { stdio: 'pipe' });
      console.log('     ✅ fork diperbarui');
    }
  } catch (e) {
    console.error(`     ❌ clone gagal: ${e.message.slice(0, 150)}`);
    console.log('        Berkas sudah tersimpan di .email-domain/ — salin manual ke domains/');
    return 1;
  }

  const berkasTujuan = [
    ['brevo1._domainkey.victer.json', berkasDkim1],
    ['brevo2._domainkey.victer.json', berkasDkim2],
    ['_dmarc.victer.json', berkasDmarc],
  ];

  for (const [nama, isi] of berkasTujuan) {
    writeFileSync(join(CLONE_DIR, 'domains', nama), JSON.stringify(isi, null, 2) + '\n', 'utf8');
  }

  console.log('     ✅ ketiga berkas disalin ke domains/');

  // ── 5. Cabang + commit + push ──────────────────────────────────────────────
  console.log('');
  console.log('  5. Commit + push...');

  const cabang = 'tambah-email-victer';

  try {
    // Cabang baru dari main, supaya tidak menumpuk perubahan lama.
    try {
      execFileSync('git', ['-C', CLONE_DIR, 'branch', '-D', cabang], { stdio: 'pipe' });
    } catch { /* cabang belum ada */ }

    execFileSync('git', ['-C', CLONE_DIR, 'checkout', '-b', cabang], { stdio: 'pipe' });
    execFileSync('git', ['-C', CLONE_DIR, 'add',
      'domains/brevo1._domainkey.victer.json',
      'domains/brevo2._domainkey.victer.json',
      'domains/_dmarc.victer.json',
    ], { stdio: 'pipe' });
    execFileSync('git', ['-C', CLONE_DIR, 'commit', '-m',
      `Add Brevo email authentication records for victer.is-a.dev\n\n`
      + `Adds DKIM and DMARC records so victer.is-a.dev can send transactional\n`
      + `email via Brevo (for the contact and account emails on my portfolio).\n\n`
      + `- brevo1._domainkey.victer.is-a.dev: Brevo DKIM key 1 (CNAME)\n`
      + `- brevo2._domainkey.victer.is-a.dev: Brevo DKIM key 2 (CNAME)\n`
      + `- _dmarc.victer.is-a.dev: DMARC policy\n\n`
      + `Brevo uses CNAME records for DKIM, so these do not conflict with the\n`
      + `existing CNAME on the root domain that points to Cloudflare Pages.`,
    ], { stdio: 'pipe' });
    execFileSync('git', ['-C', CLONE_DIR, 'push', '-f', 'origin', cabang], { stdio: 'pipe' });

    console.log(`     ✅ didorong ke cabang ${cabang}`);
  } catch (e) {
    console.error(`     ❌ ${String(e.message).slice(0, 200)}`);
    return 1;
  }

  // ── 6. Buat pull request ───────────────────────────────────────────────────
  //
  // ── KENAPA BODY-NYA HARUS PERSIS SEPERTI INI ───────────────────────────────
  // Repo is-a.dev punya workflow `check-pr-template.cjs` yang MEMVALIDASI isi
  // PR. PR yang tidak memakai template (atau menghapus komentar penandanya)
  // otomatis GAGAL sebelum dilihat manusia.
  //
  // Karena itu body di bawah mempertahankan SELURUH komentar penanda
  // (`<!-- TOS -->`, `<!-- WEBSITE_PREVIEW_START -->`, dst) apa adanya, dan
  // hanya mengubah checkbox `[ ]` menjadi `[x]`.
  //
  // Komentar "Requirements" menyebut: jangan ubah apa pun di bagian itu
  // selain checkbox — kalau diubah, PR gagal validasi.
  console.log('');
  console.log('  6. Membuat pull request...');

  const bodyPr = [
    '<!--',
    'YOU MUST FILL OUT THIS ENTIRE TEMPLATE FOR YOUR PR TO BE APPROVED!',
    '',
    'DO NOT MODIFY OR REMOVE THIS TEMPLATE (INCLUDING REMOVING COMMENTS) OR YOUR PR WILL FAIL VALIDATION!',
    '-->',
    '',
    '# Requirements',
    '<!-- Your domain MUST pass ALL the requirements below, otherwise it WILL BE DENIED. -->',
    '<!-- Change each checkbox to [x] (all lowercase, with no spaces between the brackets) to mark it as completed. -->',
    '<!-- Do not modify anything in this section other than the checkboxes, or your PR will fail validation. -->',
    '',
    '- [x] <!-- TOS --> I **agree** to the [Terms of Service](https://is-a.dev/terms). <!-- Your request MUST follow the TOS to be approved. -->',
    '- [x] <!-- DOMAIN_STRUCTURE --> My file is following the [domain structure](https://docs.is-a.dev/domain-structure/). <!-- Your file is in the domains directory, the name is valid, it is JSON format, etc. -->',
    '- [x] <!-- WEBSITE_REACHABLE --> My website is **reachable** and **completed**. <!-- We do not permit simple "Hello, world!" or simply copied template websites with minimal changes. -->',
    '- [x] <!-- SOFTWARE_RELATED --> My website is **software development** related. <!-- We do not accept websites such as gaming, courses, AI agents/chatbots, etc. NOTE: Only your root subdomain needs to meet this requirement. -->',
    '- [x] <!-- NON_COMMERCIAL --> My website is **not for commercial use**. <!-- Your website\'s purpose should not be to generate any form of revenue or profit. (e.g. a business) -->',
    '- [x] <!-- CONTACT_INFO --> I have provided sufficient contact information in the `owner` key. <!-- Provide your email in the `email` field or another platform (e.g. Twitter or Discord) for contact. -->',
    '- [x] <!-- WEBSITE_LINK --> I have provided a link to my website below. <!-- This step is required for your PR to be approved. -->',
    '',
    '# Website Preview',
    '<!-- Provide a LINK (not a screenshot) to your website below between the start/end markers. -->',
    '<!-- This should be a LINK to the existing domain your website is on, NOT the is-a.dev domain you\'re applying for. (e.g. https://abc.vercel.app, https://abc.github.io) -->',
    '',
    '<!-- WEBSITE_PREVIEW_START -->',
    'https://portfolio-victer.pages.dev',
    '<!-- WEBSITE_PREVIEW_END -->',
    '',
    '# Website Purpose',
    '<!-- Please tell us the purpose or motive behind your website in between the start/end markers. For example, it is a portfolio website, etc. -->',
    '',
    '<!-- WEBSITE_PURPOSE_START -->',
    'This is my personal portfolio site as a full-stack developer. This PR does not register a new domain — victer.is-a.dev is already registered and live; it only adds DNS records (DKIM, DMARC) so I can send account and contact emails from the domain via Brevo. Not used for any commercial purpose.',
    '<!-- WEBSITE_PURPOSE_END -->',
    '',
    '---',
    '',
    '### Additional context',
    '',
    'This PR adds email authentication records for `victer.is-a.dev` (already registered and live) so the domain can send transactional email — password resets, account notifications — via Brevo.',
    '',
    'Brevo uses **CNAME records** for DKIM, so these do not conflict with the existing CNAME on the root domain that points to Cloudflare Pages:',
    '',
    '- `brevo1._domainkey.victer.is-a.dev` — Brevo DKIM key 1 (CNAME)',
    '- `brevo2._domainkey.victer.is-a.dev` — Brevo DKIM key 2 (CNAME)',
    '- `_dmarc.victer.is-a.dev` — DMARC policy (TXT)',
    '',
    'This follows the same pattern already used by other domains in this repo (e.g. `brevo1._domainkey.m1st4ck.json`, `brevo1._domainkey.mehdi-kheireddine.json`).',
    '',
    '<details><summary>Records</summary>',
    '',
    '```json',
    JSON.stringify(berkasDkim1, null, 2),
    '```',
    '',
    '```json',
    JSON.stringify(berkasDkim2, null, 2),
    '```',
    '',
    '```json',
    JSON.stringify(berkasDmarc, null, 2),
    '```',
    '',
    '</details>',
  ].join('\n');

  try {
    const url = execFileSync('gh', ['pr', 'create',
      '--repo', REPO_UPSTREAM,
      '--head', `VicterHong:${cabang}`,
      '--title', 'Add Brevo email records for victer.is-a.dev',
      '--body', bodyPr,
    ], { stdio: 'pipe' }).toString().trim();

    console.log(`     ✅ PR dibuat: ${url}`);
    console.log('');
    console.log('  ══ SELESAI ══');
    console.log('');
    console.log('  Langkah berikutnya:');
    console.log('    1. Tunggu PR di-merge oleh maintainer is-a.dev');
    console.log('    2. Jalankan: node scripts/setup-domain-email.mjs --verifikasi');
    console.log('    3. Isi EMAIL_FROM di service.env:');
    console.log(`         EMAIL_FROM=VIVASTIC <noreply@${DOMAIN_EMAIL}>`);
    console.log('    4. Restart backend + uji kirim');
    console.log('');
    return 0;

  } catch (e) {
    const pesan = String(e.stdout ?? e.message);
    if (pesan.includes('already exists')) {
      console.log('     ℹ️  PR sudah ada — cek di GitHub');
    } else {
      console.error(`     ❌ ${pesan.slice(0, 250)}`);
    }
    return 1;
  }
}

// ── Perintah: verifikasi ──────────────────────────────────────────────────────

async function verifikasi() {
  console.log('');
  console.log('  ══ VERIFIKASI DOMAIN (BREVO) ══');
  console.log('');

  if (!kunciBrevo()) {
    console.error('  ❌ BREVO_API_KEY belum diisi.');
    console.log('');
    console.log('  Daftar di https://brevo.com → Settings → SMTP & API → API Keys');
    console.log('  Lalu tambahkan ke ~/.portfolio-token/service.env:');
    console.log('    BREVO_API_KEY=xkeysib-xxxxxxxxxxxx');
    console.log('');
    return 1;
  }

  try {
    const hasil = await brevo('/senders/domains');
    const domain = (hasil?.domains ?? []).find((d) => d.domain_name === DOMAIN_BREVO);

    if (!domain) {
      console.error(`  ❌ ${DOMAIN_BREVO} belum ditambahkan — jalankan --siapkan dulu`);
      return 1;
    }

    console.log(`  Domain  : ${domain.domain_name}`);
    console.log(`  Verified: ${domain.verified ? '✅ ya' : '⏳ belum'}`);
    console.log('');

    if (domain.verified) {
      console.log('  ✅ Domain sudah terverifikasi — Brevo bisa mengirim dari domain ini.');
      console.log('');
      return 0;
    }

    // ── Cek DNS manual (Brevo tidak punya endpoint "verify" terpisah) ────────
    //
    // Brevo memeriksa DNS secara berkala sendiri. Yang bisa kita lakukan:
    // memastikan record-nya sudah ada di DNS publik. Kalau belum, berarti
    // PR is-a.dev belum di-merge.
    console.log('  Brevo memeriksa DNS secara berkala sendiri — tidak ada endpoint');
    console.log('  "verifikasi sekarang". Yang bisa dilakukan: memastikan record');
    console.log('  sudah ada di DNS publik.');
    console.log('');
    console.log('  Jalankan perintah ini untuk memeriksa:');
    console.log(`    dig CNAME brevo1._domainkey.${DOMAIN_BREVO}`);
    console.log(`    dig CNAME brevo2._domainkey.${DOMAIN_BREVO}`);
    console.log(`    dig TXT _dmarc.${DOMAIN_BREVO}`);
    console.log('');
    console.log('  Kalau record sudah muncul tapi Brevo masih "belum": tunggu 15-30');
    console.log('  menit, atau klik "Verify" di dashboard Brevo:');
    console.log('    https://app.brevo.com/senders/domain/list');
    console.log('');
    return 0;

  } catch (e) {
    console.error(`  ❌ ${e.message}`);
    return 1;
  }
}

// ── Titik masuk ───────────────────────────────────────────────────────────────

const perintah = process.argv[2] ?? '--status';

const hasil = perintah === '--siapkan' ? await siapkan()
  : perintah === '--verifikasi' ? await verifikasi()
  : await status();

process.exit(hasil);
