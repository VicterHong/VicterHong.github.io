#!/usr/bin/env node
/**
 * Pemeriksa & pemasang kredensial OAuth.
 *
 * ── KENAPA SKRIP INI ADA ─────────────────────────────────────────────────────
 * Mengisi kredensial OAuth secara manual rawan tiga kesalahan:
 *
 *   1. SALAH TEMPEL — menyalin Client ID ke baris Client Secret, atau
 *      sebaliknya. Gejalanya di produksi: "invalid_client" yang tidak
 *      menjelaskan apa pun.
 *
 *   2. SPASI TERSEMBUNYI — menyalin dari web sering membawa spasi di ujung.
 *      Kredensial dengan spasi di ujung GAGAL, tapi terlihat benar di layar.
 *
 *   3. REDIRECT URI TIDAK TERDAFTAR — kesalahan paling sering. Kredensial
 *      benar, tapi provider menolak karena URI-nya belum didaftarkan.
 *      Gejalanya "redirect_uri_mismatch" — dan itu tidak muncul sampai
 *      pengguna mencoba login.
 *
 * Skrip ini memeriksa ketiganya SEBELUM kredensial dipasang, jadi kesalahan
 * ketahuan di sini, bukan di produksi saat pengguna sedang login.
 *
 * ── CARA PAKAI ───────────────────────────────────────────────────────────────
 *   node pasang-kredensial.mjs periksa          # cek yang sudah terpasang
 *   node pasang-kredensial.mjs google           # pasang Google (interaktif)
 *   node pasang-kredensial.mjs github           # pasang GitHub
 *   node pasang-kredensial.mjs microsoft
 *   node pasang-kredensial.mjs apple
 *   node pasang-kredensial.mjs uji-google       # uji kredensial Google
 *
 * Skrip ini TIDAK menulis ke berkas env produksi secara langsung. Ia
 * menampilkan baris yang harus ditambahkan, dan memverifikasi hasilnya
 * setelah Anda menambahkannya. Alasannya: berkas env produksi berisi
 * rahasia lain (SERVICE_SECRET, ADMIN_KEY), dan menulis ulang berkas itu
 * secara otomatis berisiko merusaknya.
 */

import { createInterface } from 'node:readline';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Path bisa diarahkan lewat ENV_FILE untuk pengujian — supaya deteksi bisa
// diuji tanpa menyentuh berkas produksi yang berisi rahasia lain.
const ENV_PRODUKSI = process.env.ENV_FILE || join(homedir(), '.portfolio-token', 'service.env');
const SITE_URL = 'https://portfolio-victer.pages.dev';

// ── Definisi provider ─────────────────────────────────────────────────────────
//
// Setiap provider punya kebutuhan berbeda. Perbedaan itu dinyatakan sebagai
// data di sini, bukan sebagai cabang if di tengah alur — supaya alur utamanya
// tetap satu.

const PROVIDER = {
  google: {
    nama: 'Google',
    kunci: [
      { nama: 'GOOGLE_CLIENT_ID', label: 'Client ID', pola: /\.apps\.googleusercontent\.com$/, contoh: '123456-abc.apps.googleusercontent.com' },
      { nama: 'GOOGLE_CLIENT_SECRET', label: 'Client secret', pola: /^GOCSPX-/, contoh: 'GOCSPX-xxxxx' },
    ],
    redirect: `${SITE_URL}/api/auth/google/callback`,
    konsol: 'https://console.cloud.google.com/apis/credentials',
    petunjuk: [
      'Create Credentials → OAuth client ID → Web application',
      'Authorized redirect URIs → tambahkan URI di bawah',
    ],
  },

  github: {
    nama: 'GitHub',
    kunci: [
      { nama: 'GITHUB_CLIENT_ID', label: 'Client ID', pola: /^(Ov23li|Iv1\.)/, contoh: 'Ov23liXXXXXXXX' },
      { nama: 'GITHUB_CLIENT_SECRET', label: 'Client secret', pola: /^[a-f0-9]{40}$/, contoh: '40 karakter heksadesimal' },
    ],
    redirect: `${SITE_URL}/api/auth/github/callback`,
    konsol: 'https://github.com/settings/developers',
    petunjuk: [
      'New OAuth App',
      'Authorization callback URL → isi URI di bawah',
    ],
  },

  microsoft: {
    nama: 'Microsoft',
    kunci: [
      { nama: 'MICROSOFT_CLIENT_ID', label: 'Application (client) ID', pola: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, contoh: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { nama: 'MICROSOFT_CLIENT_SECRET', label: 'Client secret VALUE', pola: /^.{20,}$/, contoh: 'xxxxx~xxxxx (VALUE, bukan Secret ID)' },
    ],
    redirect: `${SITE_URL}/api/auth/microsoft/callback`,
    konsol: 'https://portal.azure.com → Microsoft Entra ID → App registrations',
    petunjuk: [
      'New registration → Redirect URI → platform Web',
      'Certificates & secrets → New client secret → salin VALUE-nya',
      'JANGAN tandai redirect URI sebagai "spa"',
    ],
  },

  sso: {
    nama: 'SSO (OIDC)',
    kunci: [
      { nama: 'SSO_ISSUER', label: 'Issuer (URL dasar IdP)', pola: /^https:\/\/[a-z0-9.-]+/i, contoh: 'https://vivastic.cloudflareaccess.com' },
      { nama: 'SSO_CLIENT_ID', label: 'Client ID', pola: /^.{8,}$/, contoh: 'dari IdP Anda' },
      { nama: 'SSO_CLIENT_SECRET', label: 'Client secret', pola: /^.{8,}$/, contoh: 'dari IdP Anda' },
    ],
    redirect: `${SITE_URL}/api/auth/sso/callback`,
    konsol: 'https://one.dash.cloudflare.com → Access → Applications → Add → SaaS → OIDC',
    petunjuk: [
      'Aktifkan Zero Trust dulu (gratis sampai 50 user)',
      'Access → Applications → Add an application → SaaS',
      'Authentication protocol: OIDC',
      'Redirect URL → isi URI di bawah',
      'Salin Client ID + Client Secret (secret hanya terlihat sekali)',
    ],
    opsional: [
      { nama: 'SSO_LABEL', label: 'Label tombol (opsional)', contoh: 'Cloudflare' },
      { nama: 'SSO_DOMAINS', label: 'Domain email yang boleh (opsional, dipisah koma)', contoh: 'vivastic.id' },
    ],
  },

  apple: {
    nama: 'Apple',
    kunci: [
      { nama: 'APPLE_CLIENT_ID', label: 'Services ID', pola: /^[a-z0-9.-]+$/i, contoh: 'id.vivastic.signin' },
      { nama: 'APPLE_TEAM_ID', label: 'Team ID', pola: /^[A-Z0-9]{10}$/, contoh: 'ABCDE12345' },
      { nama: 'APPLE_KEY_ID', label: 'Key ID', pola: /^[A-Z0-9]{10}$/, contoh: 'XYZ9876543' },
      { nama: 'APPLE_PRIVATE_KEY', label: 'Isi berkas .p8', pola: /-----BEGIN PRIVATE KEY-----/, contoh: 'MIGTAgEAMBMGByqGSM49... (baris baru ditulis \\n)' },
    ],
    redirect: `${SITE_URL}/api/auth/apple/callback`,
    konsol: 'https://developer.apple.com/account/resources/identifiers',
    petunjuk: [
      'Identifiers → + → Services IDs (BUKAN App IDs)',
      'Centang Sign In with Apple → Configure → isi Domain + Return URL',
      'Keys → + → Sign in with Apple → unduh .p8 (hanya sekali)',
    ],
  },
};

// ── Helper ────────────────────────────────────────────────────────────────────

const warna = {
  hijau: (s) => `\x1b[32m${s}\x1b[0m`,
  merah: (s) => `\x1b[31m${s}\x1b[0m`,
  kuning: (s) => `\x1b[33m${s}\x1b[0m`,
  redup: (s) => `\x1b[2m${s}\x1b[0m`,
  tebal: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** Baca berkas env produksi sebagai objek. Nilai tidak pernah dicetak. */
function bacaEnv() {
  if (!existsSync(ENV_PRODUKSI)) return {};
  const hasil = {};
  for (const baris of readFileSync(ENV_PRODUKSI, 'utf8').split('\n')) {
    const bersih = baris.trim();
    if (!bersih || bersih.startsWith('#')) continue;
    const idx = bersih.indexOf('=');
    if (idx < 0) continue;
    hasil[bersih.slice(0, idx).trim()] = bersih.slice(idx + 1).trim();
  }
  return hasil;
}

/** Tampilkan nilai dengan aman: hanya 6 karakter awal + panjangnya. */
function samarkan(nilai) {
  if (!nilai) return warna.redup('(kosong)');
  const awal = nilai.slice(0, 6);
  return `${awal}… ${warna.redup(`(${nilai.length} karakter)`)}`;
}

/** Buang spasi/baris baru yang sering ikut saat menyalin dari web. */
function bersihkan(nilai) {
  return String(nilai ?? '').trim().replace(/^["']|["']$/g, '');
}

const tanya = (teks) => new Promise((resolve) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(teks, (jawaban) => { rl.close(); resolve(jawaban); });
});

// ── Perintah: periksa ─────────────────────────────────────────────────────────

function periksa() {
  const env = bacaEnv();
  console.log(`\n${warna.tebal('Kredensial OAuth — keadaan sekarang')}\n`);
  console.log(`  berkas: ${ENV_PRODUKSI}`);
  console.log(`  ${existsSync(ENV_PRODUKSI) ? warna.hijau('ada') : warna.merah('TIDAK ADA')}\n`);

  for (const [id, p] of Object.entries(PROVIDER)) {
    const terisi = p.kunci.filter((k) => env[k.nama]);
    const lengkap = terisi.length === p.kunci.length;

    const tanda = lengkap ? warna.hijau('✅ siap') : (terisi.length > 0 ? warna.kuning('⚠️  sebagian') : warna.redup('⬜ kosong'));
    console.log(`  ${p.nama.padEnd(12)} ${tanda}`);

    for (const k of p.kunci) {
      const nilai = env[k.nama];
      if (!nilai) {
        console.log(`     ${warna.redup('·')} ${k.nama.padEnd(26)} ${warna.redup('belum diisi')}`);
        continue;
      }
      const cocok = k.pola.test(nilai);
      console.log(`     ${cocok ? warna.hijau('✓') : warna.merah('✗')} ${k.nama.padEnd(26)} ${samarkan(nilai)}`);
      if (!cocok) {
        console.log(`       ${warna.merah('format tidak sesuai')} — contoh: ${k.contoh}`);
      }
    }
    console.log();
  }

  const siap = Object.entries(PROVIDER).filter(([, p]) => p.kunci.every((k) => env[k.nama]));
  console.log(`  ${warna.tebal('Kesimpulan:')} ${siap.length} dari ${Object.keys(PROVIDER).length} provider siap.`);
  if (siap.length === 0) {
    console.log(`  ${warna.redup('Passkey sudah aktif tanpa kredensial apa pun.')}`);
  }
  console.log();
}

// ── Perintah: pasang <provider> ───────────────────────────────────────────────

async function pasang(id) {
  const p = PROVIDER[id];
  if (!p) {
    console.log(warna.merah(`\n  Provider "${id}" tidak dikenal.`));
    console.log(`  Pilihan: ${Object.keys(PROVIDER).join(', ')}\n`);
    process.exit(1);
  }

  console.log(`\n${warna.tebal(`Memasang kredensial ${p.nama}`)}\n`);

  console.log(`  ${warna.tebal('1. Buka konsol provider:')}`);
  console.log(`     ${p.konsol}\n`);

  console.log(`  ${warna.tebal('2. Yang perlu dilakukan:')}`);
  for (const t of p.petunjuk) console.log(`     • ${t}`);
  console.log();

  console.log(`  ${warna.tebal('3. Redirect URI yang WAJIB didaftarkan (sama persis):')}`);
  console.log(`     ${warna.kuning(p.redirect)}\n`);
  console.log(`     ${warna.redup('RFC 9700 melarang pencocokan pola untuk redirect URI —')}`);
  console.log(`     ${warna.redup('perbandingan byte per byte. Satu garis miring tambahan akan ditolak.')}\n`);

  const nilai = {};
  const semuaKunci = [...p.kunci, ...(p.opsional || [])];
  for (const k of semuaKunci) {
    const mentah = await tanya(`  ${k.label}: `);
    const jawaban = bersihkan(mentah);

    // Spasi/baris baru di ujung adalah penyebab kegagalan yang paling sulit
    // dilihat — nilainya terlihat benar di layar tapi ditolak provider.
    // Dibuang otomatis, dan diberitahukan supaya pengguna tahu.
    if (mentah !== jawaban && mentah.trim() === jawaban) {
      console.log(warna.kuning('     (spasi di ujung dibuang)'));
    }

    if (!jawaban) {
      console.log(warna.merah(`\n  Dibatalkan — ${k.label} kosong.\n`));
      process.exit(1);
    }

    if (!jawaban && p.opsional?.includes(k)) {
      console.log(warna.redup('     (dilewati)'));
      continue;
    }

    if (k.pola && !k.pola.test(jawaban)) {
      console.log(warna.kuning(`  ⚠️  Format tidak seperti biasanya.`));
      console.log(`     Contoh yang benar: ${k.contoh}`);
      const lanjut = bersihkan(await tanya('     Tetap pakai nilai ini? (y/n): '));
      if (lanjut.toLowerCase() !== 'y') {
        console.log(warna.redup('\n  Dibatalkan.\n'));
        process.exit(1);
      }
    }

    nilai[k.nama] = jawaban;
    console.log(warna.hijau(`     ✓ ${k.nama}`));
  }

  console.log(`\n${warna.tebal('4. Tambahkan baris ini ke berkas env:')}\n`);
  console.log(`   ${warna.redup(`nano ${ENV_PRODUKSI}`)}\n`);
  for (const [nama, isi] of Object.entries(nilai)) {
    console.log(`   ${nama}=${isi}`);
  }
  console.log();

  console.log(`  ${warna.tebal('5. Muat ulang layanan:')}`);
  console.log(`     ${warna.redup('sudo systemctl restart portfolio-token.service')}\n`);

  console.log(`  ${warna.tebal('6. Verifikasi:')}`);
  console.log(`     ${warna.redup('node pasang-kredensial.mjs periksa')}`);
  console.log(`     ${warna.redup(`node pasang-kredensial.mjs uji-${id}`)}\n`);

  console.log(`  ${warna.redup('Catatan: skrip ini tidak menulis ke env secara langsung.')}`);
  console.log(`  ${warna.redup('Berkas itu berisi SERVICE_SECRET dan ADMIN_KEY — menulis')}`);
  console.log(`  ${warna.redup('ulang otomatis berisiko merusaknya.')}\n`);
}

// ── Perintah: uji-<provider> ──────────────────────────────────────────────────

async function uji(id) {
  const p = PROVIDER[id];
  if (!p) {
    console.log(warna.merah(`\n  Provider "${id}" tidak dikenal.\n`));
    process.exit(1);
  }

  const env = bacaEnv();
  console.log(`\n${warna.tebal(`Menguji kredensial ${p.nama}`)}\n`);

  const kosong = p.kunci.filter((k) => !env[k.nama]);
  if (kosong.length > 0) {
    console.log(warna.merah(`  Belum lengkap — kosong: ${kosong.map((k) => k.nama).join(', ')}\n`));
    process.exit(1);
  }

  // ── Uji 1: format ─────────────────────────────────────────────────────────
  let formatOk = true;
  for (const k of p.kunci) {
    const cocok = k.pola.test(env[k.nama]);
    console.log(`  ${cocok ? warna.hijau('✅') : warna.merah('❌')} format ${k.nama}`);
    if (!cocok) formatOk = false;
  }

  // ── Uji 2: kredensial diterima provider ───────────────────────────────────
  //
  // Cara paling jujur: minta provider memvalidasi. Yang dipakai adalah
  // endpoint token dengan code palsu — provider akan menolak, TAPI pesan
  // penolakannya membedakan dua hal penting:
  //
  //   "invalid_client"  → kredensial SALAH (client id/secret keliru)
  //   "invalid_grant"   → kredensial BENAR (hanya code-nya yang palsu)
  //
  // Perbedaan itu persis yang kita butuhkan.
  console.log(`\n  ${warna.tebal('Menguji ke provider…')}`);

  try {
    let hasil;

    if (id === 'google') {
      const body = new URLSearchParams({
        code: 'uji-palsu', client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: p.redirect,
        grant_type: 'authorization_code',
      });
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      });
      hasil = await r.json(); hasil.__http = r.status;
    } else if (id === 'github') {
      const body = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
        code: 'uji-palsu',
      });
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { Accept: 'application/json' }, body,
      });
      hasil = await r.json(); hasil.__http = r.status;
    } else if (id === 'microsoft') {
      const body = new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET,
        code: 'uji-palsu', redirect_uri: p.redirect, grant_type: 'authorization_code',
      });
      const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      });
      hasil = await r.json(); hasil.__http = r.status;
    } else {
      console.log(warna.kuning('\n  Apple tidak bisa diuji dengan cara ini.'));
      console.log(`  ${warna.redup('Client secret Apple adalah JWT yang ditandatangani kunci .p8 —')}`);
      console.log(`  ${warna.redup('kalau kuncinya salah, JWT-nya gagal dibuat, bukan ditolak provider.')}`);
      console.log(`  ${warna.redup('Uji dengan login sungguhan setelah dipasang.')}\n`);
      process.exit(formatOk ? 0 : 1);
    }

    // ── Analisis respons: per provider, dari data pengujian nyata ────────────
    //
    // Urutan pemeriksaan penting: kode HTTP dulu, baru pesan. Pesan bisa
    // sama untuk kasus berbeda (Microsoft memakai 'invalid_grant' untuk
    // client_id yang tidak ada), sedangkan kode HTTP lebih dapat diandalkan.

    const galat = hasil.error || '';
    const deskripsi = (hasil.error_description || '');
    const kodeAad = (hasil.error_codes || []).join(',');
    const http = hasil.__http;

    console.log(`\n  ${warna.redup(`Respons: HTTP ${http} · ${galat || '(tanpa error)'}`)}`);

    // ── GitHub: 404 = client tidak ada ───────────────────────────────────────
    if (id === 'github' && (http === 404 || galat === 'Not Found')) {
      console.log(warna.merah('\n  ❌ Kredensial SALAH'));
      console.log(`     GitHub tidak mengenali client id itu.`);
      console.log(`     ${warna.redup('Periksa: apakah Client ID tersalin lengkap dari halaman OAuth App?')}\n`);
      process.exit(1);
    }

    // ── Microsoft: periksa kode AADSTS ───────────────────────────────────────
    //
    // Microsoft TIDAK memakai 'invalid_client' untuk client_id yang tidak ada.
    // Ia mengembalikan 'invalid_grant' dengan kode AADSTS di dalamnya. Tanpa
    // memeriksa kode itu, kita akan salah melaporkan "kredensial benar".
    if (id === 'microsoft') {
      if (/7000215|7000222|700016|70001|AADSTS70002/i.test(kodeAad + deskripsi)) {
        console.log(warna.merah('\n  ❌ Kredensial SALAH'));
        console.log(`     Microsoft menolak client id atau secret.`);
        console.log(`     ${warna.redup(`Kode: ${kodeAad || deskripsi.slice(0, 80)}`)}\n`);
        process.exit(1);
      }
      if (/AADSTS9002313|9002313/i.test(kodeAad + deskripsi)) {
        // Kode ini muncul untuk code palsu — artinya kredensial lolos tahap
        // awal. Tapi Microsoft baru memvalidasi secret saat menukar code asli,
        // jadi ini BUKAN bukti kredensial benar — hanya bukti formatnya sah.
        console.log(warna.kuning('\n  ⚠️  Kredensial formatnya sah, tapi BELUM terverifikasi'));
        console.log(`     Microsoft memvalidasi secret saat menukar code asli.`);
        console.log(`     ${warna.redup('Uji dengan login sungguhan untuk memastikan.')}\n`);
        process.exit(0);
      }
    }

    // ── Google: 401 invalid_client = client tidak dikenal ────────────────────
    if (galat === 'invalid_client' || galat === 'incorrect_client_credentials' || galat === 'unauthorized_client') {
      console.log(warna.merah('\n  ❌ Kredensial SALAH'));
      console.log(`     Provider tidak mengenali client id atau secret.`);
      console.log(`     Periksa: apakah tersalin lengkap? Apakah Client ID dan Secret tertukar?`);
      console.log(`     ${warna.redup(`Respons: ${galat}${deskripsi ? ' — ' + deskripsi.slice(0, 80) : ''}`)}\n`);
      process.exit(1);
    }

    // ── Format tidak valid (400 invalid_request dari Google) ─────────────────
    if (galat === 'invalid_request') {
      console.log(warna.kuning('\n  ⚠️  Format kredensial tidak diterima provider'));
      console.log(`     Client ID terlihat tidak sah — Google menolak sebelum memeriksa.`);
      console.log(`     ${warna.redup('Pastikan Client ID berakhiran .apps.googleusercontent.com')}\n`);
      process.exit(1);
    }

    // ── Redirect URI belum terdaftar ─────────────────────────────────────────
    if (galat === 'redirect_uri_mismatch' || deskripsi.includes('redirect')) {
      console.log(warna.kuning('\n  ⚠️  Kredensial BENAR, tapi redirect URI belum terdaftar'));
      console.log(`     Daftarkan URI ini di konsol provider, sama persis:`);
      console.log(`     ${warna.kuning(p.redirect)}\n`);
      process.exit(1);
    }

    // ── GitHub: bad_verification_code = kredensial BENAR ─────────────────────
    //
    // GitHub memeriksa kredensial LEBIH DULU, baru code-nya. Kalau
    // kredensialnya salah, ia bilang 'incorrect_client_credentials'. Kalau
    // kredensialnya benar dan hanya code yang salah, ia bilang
    // 'bad_verification_code' — dan itulah yang kita harapkan di sini.
    if (id === 'github' && galat === 'bad_verification_code') {
      console.log(warna.hijau('\n  ✅ Kredensial BENAR'));
      console.log(`     GitHub menerima client id + secret Anda.`);
      console.log(`     Ia hanya menolak code palsu — itu memang yang diharapkan.`);
      console.log(`     ${warna.redup('Login sungguhan akan berhasil.')}\n`);
      process.exit(0);
    }

    // ── invalid_grant murni (bukan Microsoft) = kredensial benar ─────────────
    if (galat === 'invalid_grant') {
      console.log(warna.hijau('\n  ✅ Kredensial BENAR'));
      console.log(`     Provider mengenali client id + secret, dan hanya menolak`);
      console.log(`     code palsu — itu memang yang diharapkan.\n`);
      process.exit(0);
    }

    console.log(warna.kuning('\n  ⚠️  Respons tidak dikenali — periksa manual'));
    console.log(`     ${warna.redup(JSON.stringify(hasil).slice(0, 180))}\n`);
    process.exit(1);

  } catch (err) {
    console.log(warna.merah(`\n  ❌ Tidak bisa menghubungi provider: ${err.message}\n`));
    process.exit(1);
  }
}

// ── Titik masuk ───────────────────────────────────────────────────────────────

const perintah = process.argv[2] || 'periksa';

if (perintah === 'periksa') {
  periksa();
} else if (perintah.startsWith('uji-')) {
  uji(perintah.slice(4));
} else if (PROVIDER[perintah]) {
  pasang(perintah);
} else {
  console.log(`
${warna.tebal('Pemeriksa & pemasang kredensial OAuth')}

  node pasang-kredensial.mjs periksa        cek kredensial yang terpasang
  node pasang-kredensial.mjs <provider>     pasang (google|github|microsoft|apple)
  node pasang-kredensial.mjs uji-<provider> uji kredensial yang terpasang

Passkey sudah aktif dan tidak butuh kredensial apa pun.
`);
}
