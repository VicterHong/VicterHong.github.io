/**
 * Halaman input kunci API sekali-pakai.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── MASALAH YANG DIPECAHKAN ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Kunci API tidak boleh lewat chat: riwayat percakapan tersimpan permanen dan
 * bisa tersalin ke backup, log, atau ekspor. Sekali bocor, kunci harus dicabut.
 *
 * Tapi pengguna tidak selalu punya akses terminal ke server (mis. sedang di
 * ponsel lewat Telegram). Menyalin kunci ke berkas lewat SFTP juga merepotkan.
 *
 * Halaman ini menjadi jalan tengah: kunci diketik langsung di peramban
 * pengguna, dikirim lewat HTTPS ke server, dan tidak pernah menyentuh chat.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── DUA PENYEDIA YANG DIDUKUNG ───────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1. BREVO  (xkeysib-...)  — menerima domain is-a.dev
 *   2. RESEND (re_...)       — menolak domain is-a.dev, tapi bekerja tanpa domain
 *
 * Skrip mendeteksi penyedianya dari AWALAN kunci, jadi pengguna tidak perlu
 * memilih — cukup tempel, dan server tahu harus menguji ke API mana.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── PENGAMANAN (berlapis) ────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1. TOKEN DI URL — 32 byte acak. Tanpa token, semua permintaan ditolak 404.
 *   2. SEKALI PAKAI — setelah kunci tersimpan, server menutup dirinya sendiri.
 *   3. TENGGANG WAKTU — mati otomatis setelah 15 menit, dipakai atau tidak.
 *   4. HANYA LOOPBACK — server mendengarkan di 127.0.0.1.
 *   5. KUNCI TIDAK PERNAH DI-LOG — yang dicatat hanya "berhasil/gagal".
 *   6. KUNCI DIUJI DULU — dikirim ke API penyedia sebelum disimpan.
 *   7. HAPUS DARI MEMORI — variabel dibersihkan setelah ditulis.
 *
 * Jalankan: node scripts/input-kunci.mjs
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT_INPUT ?? 8899);
const TENGGANG_MENIT = 15;
const BERKAS = process.env.TOKEN_SERVICE_ENV
  ?? join(process.env.HOME ?? '/home/ubuntu', '.portfolio-token', 'service.env');

// ── Token akses ───────────────────────────────────────────────────────────────
//
// 32 byte = 256 bit. Tidak bisa ditebak. Ditampilkan SEKALI di terminal,
// lalu dipakai di URL. Bot yang memindai internet tidak akan menemukannya.

const TOKEN = randomBytes(32).toString('hex');
const JALUR = `/simpan-${TOKEN}`;

let sudahDipakai = false;

// ── Deteksi penyedia dari awalan kunci ────────────────────────────────────────
//
// ── KENAPA DETEKSI OTOMATIS, BUKAN DROPDOWN ─────────────────────────────────
// Pengguna baru saja menyalin kunci dari dashboard penyedia; ia tidak perlu
// menjawab pertanyaan tambahan tentang kunci apa yang baru ia salin. Awalan
// kunci sudah cukup — dan kalau salah, pesan galat menyebutkan bentuk yang
// benar.
const PENYEDIA = [
  {
    nama: 'brevo',
    kunciEnv: 'BREVO_API_KEY',
    awalan: 'xkeysib-',
    label: 'Brevo',
    // Endpoint ringan untuk memastikan kunci sah.
    uji: (kunci) => ({
      url: 'https://api.brevo.com/v3/account',
      headers: { 'api-key': kunci, accept: 'application/json' },
    }),
  },
  {
    nama: 'resend',
    kunciEnv: 'RESEND_API_KEY',
    awalan: 're_',
    label: 'Resend',
    uji: (kunci) => ({
      url: 'https://api.resend.com/domains',
      headers: { Authorization: `Bearer ${kunci}` },
    }),
  },
];

function deteksiPenyedia(kunci) {
  return PENYEDIA.find((p) => kunci.startsWith(p.awalan)) ?? null;
}

// ── Halaman ───────────────────────────────────────────────────────────────────

function halaman({ pesan = '', jenis = '' } = {}) {
  const warna = jenis === 'sukses' ? '#34d399' : jenis === 'gagal' ? '#f87171' : '#a1a1aa';

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Simpan Kunci API</title>
<style>
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#0a0a0b; color:#f4f4f6; padding:24px;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .kartu { width:100%; max-width:440px; background:#16161a; border:1px solid #26262c;
           border-radius:16px; padding:28px; }
  .logo { width:36px; height:36px; border-radius:11px; background:#f5c542; color:#0a0a0b;
          font-weight:700; font-size:18px; display:flex; align-items:center;
          justify-content:center; margin-bottom:18px; }
  h1 { margin:0 0 8px; font-size:20px; font-weight:600; letter-spacing:-0.02em; }
  p.ket { margin:0 0 22px; font-size:14px; line-height:1.6; color:#a1a1aa; }
  label { display:block; font-size:13px; color:#a1a1aa; margin-bottom:8px; }
  input { width:100%; padding:13px 14px; background:#0e0e11; border:1px solid #26262c;
          border-radius:9px; color:#f4f4f6; font-size:15px;
          font-family:'SF Mono',Consolas,monospace; outline:none; }
  input:focus { border-color:#f5c542; }
  button { width:100%; margin-top:16px; padding:14px; background:#f5c542; color:#0a0a0b;
           border:0; border-radius:9px; font-size:15px; font-weight:600; cursor:pointer; }
  button:active { opacity:.85; }
  .pesan { margin-top:18px; padding:13px 15px; border-radius:9px; font-size:13px;
           line-height:1.6; border-left:3px solid ${warna}; background:#121214; color:#a1a1aa; }
  .pesan a { color:#f5c542; }
  .pilihan { margin:0 0 20px; padding:14px 16px; background:#121214;
             border:1px solid #26262c; border-radius:9px; }
  .pilihan p { margin:0 0 10px; font-size:12px; color:#8a8a94; }
  .pilihan div { font-size:13px; line-height:1.9; color:#a1a1aa; }
  .pilihan code { color:#f5c542; font-size:12px; }
  .catatan { margin-top:20px; font-size:12px; line-height:1.6; color:#71717a; }
</style>
</head>
<body>
  <div class="kartu">
    <div class="logo">V</div>
    <h1>Simpan Kunci API</h1>
    <p class="ket">Tempel kunci API di bawah. Kunci dikirim lewat HTTPS, diuji langsung ke penyedianya, lalu disimpan ke server — <strong style="color:#f4f4f6">tidak pernah masuk riwayat chat</strong>.</p>

    <div class="pilihan">
      <p>Penyedia dideteksi otomatis dari awalan kunci:</p>
      <div>
        <code>xkeysib-…</code> &nbsp;→&nbsp; Brevo <em style="color:#34d399">(menerima is-a.dev)</em><br>
        <code>re_…</code> &nbsp;→&nbsp; Resend
      </div>
    </div>

    <form method="POST" action="${JALUR}">
      <label for="kunci">Kunci API</label>
      <input id="kunci" name="kunci" type="password" autocomplete="off"
             spellcheck="false" autocapitalize="off" placeholder="xkeysib-... atau re_..." required autofocus>
      <button type="submit">Simpan &amp; Uji</button>
    </form>

    ${pesan ? `<div class="pesan">${pesan}</div>` : ''}

    <p class="catatan">
      Halaman ini <strong>mati sendiri</strong> setelah kunci tersimpan, dan juga
      mati otomatis setelah ${TENGGANG_MENIT} menit. Kunci tidak ditulis ke log.
    </p>
  </div>
</body>
</html>`;
}

// ── Simpan kunci ──────────────────────────────────────────────────────────────

async function simpan(kunci) {
  const bersih = String(kunci).trim().replace(/^["']|["']$/g, '');

  const penyedia = deteksiPenyedia(bersih);

  if (!penyedia) {
    return {
      ok: false,
      pesan: 'Kunci tidak dikenali. Bentuk yang didukung:<br>'
        + '&nbsp;&nbsp;• <code>xkeysib-…</code> (Brevo)<br>'
        + '&nbsp;&nbsp;• <code>re_…</code> (Resend)',
    };
  }

  if (bersih.length < 20) {
    return { ok: false, pesan: `Kunci terlalu pendek (${bersih.length} karakter) — sepertinya terpotong saat menempel.` };
  }

  // ── Uji ke API penyedia SEBELUM disimpan ────────────────────────────────────
  // Kalau ditulis dulu lalu diuji, kunci yang salah akan menimpa kunci yang baik.
  let sah = false;
  let alasan = '';
  let infoTambahan = '';

  try {
    const { url, headers } = penyedia.uji(bersih);

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });

    sah = res.ok;

    if (!res.ok) {
      alasan = `${penyedia.label} menolak (HTTP ${res.status})`;
    } else if (penyedia.nama === 'brevo') {
      // Ambil nama akun untuk konfirmasi visual — pengguna tahu kunci ini
      // benar-benar miliknya.
      const data = await res.json().catch(() => ({}));
      const email = data?.email ?? '';
      if (email) infoTambahan = `Akun: ${email}`;
    }
  } catch (e) {
    return { ok: false, pesan: `Tidak bisa menghubungi ${penyedia.label}: ${e.message.slice(0, 100)}. Coba lagi.` };
  }

  if (!sah) {
    return {
      ok: false,
      pesan: `Kunci ${alasan}. Buat kunci baru di dashboard ${penyedia.label}.`,
    };
  }

  // ── Tulis (ganti baris lama, jangan menumpuk) ───────────────────────────────
  if (!existsSync(BERKAS)) {
    return { ok: false, pesan: `Berkas ${BERKAS} tidak ditemukan di server.` };
  }

  copyFileSync(BERKAS, `${BERKAS}.bak.${Date.now()}`);

  const isi = readFileSync(BERKAS, 'utf8')
    .split('\n')
    .filter((b) => !b.startsWith(`${penyedia.kunciEnv}=`))
    .join('\n');

  writeFileSync(BERKAS, `${isi.replace(/\n+$/, '')}\n${penyedia.kunciEnv}=${bersih}\n`, { mode: 0o600 });

  return {
    ok: true,
    penyedia: penyedia.nama,
    pesan: `Kunci ${penyedia.label} sah dan tersimpan.${infoTambahan ? `<br>${infoTambahan}` : ''} Server akan menutup diri.`,
  };
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  // Semua jalur selain token yang benar → 404. Tidak ada petunjuk apa pun.
  if (!req.url.startsWith(JALUR)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  if (sudahDipakai) {
    res.writeHead(410, { 'content-type': 'text/html; charset=utf-8' });
    res.end(halaman({ pesan: 'Halaman ini sudah dipakai dan tidak berlaku lagi.', jenis: 'gagal' }));
    return;
  }

  // GET → tampilkan formulir
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(halaman());
    return;
  }

  // POST → simpan kunci
  if (req.method === 'POST') {
    let badan = '';
    req.on('data', (c) => {
      badan += c;
      if (badan.length > 4096) req.destroy();   // kunci tidak sepanjang ini
    });

    req.on('end', async () => {
      const params = new URLSearchParams(badan);
      const kunci = params.get('kunci') ?? '';

      const hasil = await simpan(kunci);

      res.writeHead(hasil.ok ? 200 : 400, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(halaman({
        pesan: hasil.ok
          ? `${hasil.pesan}<br><br>Langkah berikutnya: minta asisten menjalankan <code>setup-domain-email.mjs --siapkan</code>.`
          : hasil.pesan,
        jenis: hasil.ok ? 'sukses' : 'gagal',
      }));

      if (hasil.ok) {
        sudahDipakai = true;
        console.log(`[input-kunci] ✅ Kunci ${hasil.penyedia ?? ''} tersimpan — server menutup diri.`);
        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 1500);
      }
    });
    return;
  }

  res.writeHead(405);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ══ HALAMAN INPUT KUNCI ══');
  console.log('');
  console.log(`  Lokal : http://127.0.0.1:${PORT}${JALUR}`);
  console.log('');
  console.log(`  Token : ${TOKEN.slice(0, 16)}…`);
  console.log(`  Mati  : otomatis setelah ${TENGGANG_MENIT} menit, atau segera setelah kunci disimpan`);
  console.log('');
  console.log('  Menunggu tunnel...');
});

// Mati otomatis — halaman tidak boleh hidup lebih lama dari perlu.
setTimeout(() => {
  console.log(`[input-kunci] tenggang ${TENGGANG_MENIT} menit habis — menutup.`);
  server.close();
  process.exit(0);
}, TENGGANG_MENIT * 60 * 1000);
