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

const DOMAIN_EMAIL = 'send.victer.is-a.dev';       // subdomain pengiriman
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

  if (!kunciResend()) {
    console.error('  ❌ RESEND_API_KEY belum diisi.');
    console.log('');
    console.log('  Daftar dulu di https://resend.com → API Keys → Create');
    console.log('  Lalu tambahkan ke ~/.portfolio-token/service.env:');
    console.log('    RESEND_API_KEY=re_xxxxxxxxxxxx');
    console.log('');
    return 1;
  }

  // ── 1. Tambah domain ke Resend ─────────────────────────────────────────────
  console.log(`  1. Menambahkan ${DOMAIN_EMAIL} ke Resend...`);

  let domain;
  try {
    const ada = await resend('/domains');
    domain = (ada?.data ?? []).find((d) => d.name === DOMAIN_EMAIL);

    if (domain) {
      console.log(`     ℹ️  sudah ada (status: ${domain.status})`);
    } else {
      domain = await resend('/domains', {
        method: 'POST',
        body: JSON.stringify({
          name: DOMAIN_EMAIL,
          region: 'us-east-1',   // region dengan latensi terbaik untuk Asia-Pasifik
        }),
      });
      console.log(`     ✅ ditambahkan (id: ${domain.id})`);
    }
  } catch (e) {
    console.error(`     ❌ ${e.message}`);
    return 1;
  }

  // ── 2. Ambil record DNS ────────────────────────────────────────────────────
  console.log('');
  console.log('  2. Mengambil record DNS yang diminta Resend...');

  let detail;
  try {
    detail = await resend(`/domains/${domain.id}`);
  } catch (e) {
    console.error(`     ❌ ${e.message}`);
    return 1;
  }

  const records = detail?.records ?? [];
  console.log(`     ${records.length} record:`);
  for (const r of records) {
    const nilai = String(r.value ?? '').slice(0, 60);
    console.log(`       • ${r.record}  ${r.name}  →  ${nilai}${String(r.value ?? '').length > 60 ? '…' : ''}`);
  }

  // ── 3. Susun berkas untuk repo is-a.dev ────────────────────────────────────
  //
  // Pemisahan berkas mengikuti aturan is-a.dev:
  //   • Label dengan garis bawah (resend._domainkey) WAJIB berkas sendiri
  //   • MX + TXT di subdomain yang sama boleh satu berkas
  console.log('');
  console.log('  3. Menyusun berkas is-a.dev...');

  const dkim = records.find((r) => r.record === 'TXT' && String(r.name).includes('_domainkey'));
  const spf = records.find((r) => r.record === 'TXT' && String(r.value).startsWith('v=spf1'));
  const mx = records.find((r) => r.record === 'MX');

  const kurang = [];
  if (!dkim) kurang.push('DKIM (TXT _domainkey)');
  if (!spf) kurang.push('SPF (TXT v=spf1)');
  if (!mx) kurang.push('MX');

  if (kurang.length) {
    console.error(`     ❌ Record belum lengkap — kurang: ${kurang.join(', ')}`);
    console.error('        Coba lagi beberapa detik kemudian (Resend kadang butuh waktu).');
    return 1;
  }

  const PEMILIK = { username: 'VicterHong', email: 'victerphanjaya@gmail.com' };

  // ── KENAPA TANDA KUTIP DIBERSIHKAN ──────────────────────────────────────────
  // Resend kadang mengembalikan nilai TXT dengan tanda kutip literal
  // (mis. `"v=spf1 include:amazonses.com ~all"`). Repo is-a.dev SUDAH
  // membungkus nilai TXT dengan tanda kutip sendiri di dnsconfig.js —
  // kalau nilai kita masih berisi kutip, hasilnya jadi kutip ganda
  // (`""v=spf1 ...""`) dan SPF/DKIM tidak terbaca.
  const bersihkan = (v) => String(v ?? '').replace(/^"|"$/g, '').trim();

  const berkasDkim = {
    owner: PEMILIK,
    description: `DKIM key for Resend transactional emails (${DOMAIN_AKAR})`,
    records: { TXT: [bersihkan(dkim.value)] },
    proxied: false,
  };

  const berkasSend = {
    owner: PEMILIK,
    description: `SPF and return-path for Resend transactional emails (${DOMAIN_AKAR})`,
    records: {
      MX: [{
        target: bersihkan(mx.value).replace(/\.$/, ''),
        priority: Number(mx.priority ?? 10),
      }],
      TXT: [bersihkan(spf.value)],
    },
    proxied: false,
  };

  const keluaran = join(ROOT, '.email-domain');
  mkdirSync(keluaran, { recursive: true });

  const jalurDkim = join(keluaran, 'resend._domainkey.victer.json');
  const jalurSend = join(keluaran, 'send.victer.json');

  writeFileSync(jalurDkim, JSON.stringify(berkasDkim, null, 2) + '\n', 'utf8');
  writeFileSync(jalurSend, JSON.stringify(berkasSend, null, 2) + '\n', 'utf8');

  console.log(`     ✅ ${jalurDkim}`);
  console.log(`     ✅ ${jalurSend}`);

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

  const tujuanDkim = join(CLONE_DIR, 'domains', 'resend._domainkey.victer.json');
  const tujuanSend = join(CLONE_DIR, 'domains', 'send.victer.json');

  writeFileSync(tujuanDkim, JSON.stringify(berkasDkim, null, 2) + '\n', 'utf8');
  writeFileSync(tujuanSend, JSON.stringify(berkasSend, null, 2) + '\n', 'utf8');

  console.log('     ✅ kedua berkas disalin ke domains/');

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
    execFileSync('git', ['-C', CLONE_DIR, 'add', 'domains/resend._domainkey.victer.json', 'domains/send.victer.json'], { stdio: 'pipe' });
    execFileSync('git', ['-C', CLONE_DIR, 'commit', '-m',
      `Add Resend email records for victer.is-a.dev\n\n`
      + `Sets up transactional email sending for victer.is-a.dev via Resend.\n\n`
      + `- send.victer.is-a.dev: SPF (TXT) + return-path (MX)\n`
      + `- resend._domainkey.victer.is-a.dev: DKIM signing key\n\n`
      + `The root domain keeps its CNAME to Cloudflare Pages, so email records\n`
      + `live on the dedicated sending subdomain instead.`,
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
    '---',
    '',
    '### Additional context',
    '',
    `This PR adds email records for \`victer.is-a.dev\` (which I already own) so the domain can send transactional email via Resend.`,
    '',
    'The root domain keeps its existing CNAME to Cloudflare Pages — DNS does not allow a CNAME alongside MX/TXT records, so the email records live on a dedicated sending subdomain instead:',
    '',
    '- `send.victer.is-a.dev` — SPF (TXT) + return-path (MX)',
    '- `resend._domainkey.victer.is-a.dev` — DKIM signing key',
    '',
    'This follows the same pattern already used by other domains in this repo.',
    '',
    '<details><summary>Records</summary>',
    '',
    '```json',
    JSON.stringify(berkasSend, null, 2),
    '```',
    '',
    '```json',
    JSON.stringify(berkasDkim, null, 2),
    '```',
    '',
    '</details>',
  ].join('\n');

  try {
    const url = execFileSync('gh', ['pr', 'create',
      '--repo', REPO_UPSTREAM,
      '--head', `VicterHong:${cabang}`,
      '--title', 'Add Resend email records for victer.is-a.dev',
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
  console.log('  ══ VERIFIKASI DOMAIN ══');
  console.log('');

  if (!kunciResend()) {
    console.error('  ❌ RESEND_API_KEY belum diisi.');
    return 1;
  }

  try {
    const ada = await resend('/domains');
    const domain = (ada?.data ?? []).find((d) => d.name === DOMAIN_EMAIL);

    if (!domain) {
      console.error(`  ❌ ${DOMAIN_EMAIL} belum ditambahkan — jalankan --siapkan dulu`);
      return 1;
    }

    console.log(`  Memicu Resend memeriksa DNS untuk ${DOMAIN_EMAIL}...`);
    await resend(`/domains/${domain.id}/verify`, { method: 'POST' });

    console.log('  ⏳ Resend sedang memeriksa. Tunggu ~30 detik, lalu cek --status.');
    console.log('');
    console.log('  DNS butuh waktu menyebar (biasanya 1-5 menit setelah PR merge).');
    console.log('  Kalau masih pending setelah 15 menit, cek:');
    console.log(`    dig TXT resend._domainkey.${DOMAIN_EMAIL}`);
    console.log(`    dig TXT ${DOMAIN_EMAIL}`);
    console.log(`    dig MX ${DOMAIN_EMAIL}`);
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
