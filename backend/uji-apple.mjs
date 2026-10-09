/**
 * Uji alur Sign in with Apple memakai IdP TIRUAN.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠️  Ini menguji KODE KITA, bukan Apple. Apple sungguhan tidak dihubungi.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── KENAPA INI BERGUNA ──
 * Apple tidak punya sandbox. Tanpa uji ini, satu-satunya cara mengetahui kode
 * Apple kita benar adalah membayar $99 lalu mencobanya. Kalau ada yang salah,
 * uang sudah keluar.
 *
 * Uji ini menjalankan alur yang SAMA dengan Apple sungguhan — hanya endpoint
 * yang dialihkan ke IdP tiruan. Yang diuji adalah kode kita: callback
 * form_post, verifikasi id_token, pembuatan client_secret JWT, pembuatan sesi.
 *
 * ── CARA PAKAI ──
 *   node idp-apple-tiruan.mjs 9912 &
 *   bash /tmp/jalankan-server-uji.sh &
 *   UJI_BASE=http://127.0.0.1:8901 UJI_IDP=http://127.0.0.1:9912 node uji-apple.mjs
 */

const BASE = process.env.UJI_BASE || 'http://127.0.0.1:8901';
const IDP = process.env.UJI_IDP || 'http://127.0.0.1:9912';

let lulus = 0;
let gagal = 0;

function cek(nama, syarat, detail = '') {
  if (syarat) { lulus += 1; console.log(`  ✅ ${nama}`); }
  else { gagal += 1; console.log(`  ❌ ${nama}${detail ? ' — ' + detail : ''}`); }
}

/** Cookie jar sederhana — fetch Node tidak menyimpan cookie sendiri. */
function buatJar() {
  const isi = new Map();
  return {
    simpan(res) {
      const set = res.headers.getSetCookie?.() ?? [];
      for (const c of set) {
        const [pasangan] = c.split(';');
        const idx = pasangan.indexOf('=');
        if (idx > 0) isi.set(pasangan.slice(0, idx).trim(), pasangan.slice(idx + 1).trim());
      }
    },
    header() {
      return [...isi.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function uji() {
  const jar = buatJar();

  // ── 1. Apple dinyatakan siap ──────────────────────────────────────────────
  console.log('\n  ── 1. /api/config: Apple siap? ──');
  const cfgRes = await fetch(`${BASE}/api/config`);
  const cfg = await cfgRes.json().catch(() => ({}));
  // Struktur nyata: { sso: { google, github, microsoft, apple, sso }, passkey }
  const prov = cfg.sso || cfg.providers || cfg;
  cek('Apple dinyatakan siap', prov.apple === true, `apple=${prov.apple}`);

  // ── 2. Mulai alur → dialihkan ke IdP ──────────────────────────────────────
  console.log('\n  ── 2. Mulai alur Apple ──');
  await fetch(`${IDP}/kendali/reset-pertama`).catch(() => {});

  const mulai = await fetch(`${BASE}/api/auth/apple`, { redirect: 'manual' });
  const lokasi = mulai.headers.get('location') || '';
  jar.simpan(mulai);

  cek('mengalihkan ke IdP', lokasi.includes('127.0.0.1:9912'), lokasi.slice(0, 80));
  cek('memakai response_mode=form_post', lokasi.includes('response_mode=form_post'),
    lokasi.slice(0, 130));
  cek('memuat scope name+email',
    lokasi.includes('name') && lokasi.includes('email'), lokasi.slice(0, 130));

  const urlAuth = new URL(lokasi);
  const state = urlAuth.searchParams.get('state') || '';
  cek('state dikirim', Boolean(state));

  // ── 3. Ikuti otorisasi di IdP → dapat halaman form_post ───────────────────
  console.log('\n  ── 3. IdP mengirim hasil lewat form_post ──');
  const izin = await fetch(lokasi, { redirect: 'manual' });
  const html = await izin.text();

  cek('IdP mengembalikan form POST', izin.status === 200 && html.includes('method="POST"'),
    `status ${izin.status}`);

  // Ambil code + user dari form (ini yang dikirim browser secara nyata).
  const cocokForm = html.match(/<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/);
  const aksiForm = cocokForm?.[1] || '';
  const isiForm = cocokForm?.[2] || '';

  const ambilInput = (nama) => {
    const m = isiForm.match(new RegExp(`name="${nama}"\\s+value="([^"]*)"`));
    return m ? m[1] : '';
  };
  const ambilInputUser = () => {
    const m = isiForm.match(/name="user"\s+value='([^']*)'/);
    return m ? m[1] : '';
  };

  const codeForm = ambilInput('code');
  const stateForm = ambilInput('state');
  const userForm = ambilInputUser();

  cek('form memuat code', Boolean(codeForm));
  cek('form memuat state yang sama', stateForm === state);
  cek('form memuat nama (otorisasi pertama)', Boolean(userForm), userForm.slice(0, 60));

  // ── 4. POST ke callback kita (perilaku khas Apple) ────────────────────────
  console.log('\n  ── 4. Callback menerima POST (bukan GET) ──');
  const bodyForm = new URLSearchParams({ code: codeForm, state: stateForm });
  if (userForm) bodyForm.set('user', userForm);

  const cb = await fetch(aksiForm, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(jar.header() ? { Cookie: jar.header() } : {}),
    },
    body: bodyForm,
    redirect: 'manual',
  });
  jar.simpan(cb);

  const lokasiCb = cb.headers.get('location') || '';
  cek('callback POST diproses (bukan 405/404)',
    cb.status === 302 || cb.status === 303, `status ${cb.status}`);
  cek('tidak dialihkan ke galat',
    !lokasiCb.includes('galat='), lokasiCb.slice(0, 120));

  // ── 5. Sesi terbentuk ─────────────────────────────────────────────────────
  console.log('\n  ── 5. Sesi terbentuk ──');
  const profil = await fetch(`${BASE}/api/auth/profil`, {
    headers: jar.header() ? { Cookie: jar.header() } : {},
  });
  const dataProfil = await profil.json().catch(() => ({}));

  cek('profil bisa dibaca (sesi sah)', profil.status === 200, `status ${profil.status}`);

  const email = dataProfil?.pengguna?.email || dataProfil?.email || '';
  cek('email dari id_token Apple terpakai', email.includes('@'), email || JSON.stringify(dataProfil).slice(0, 90));

  // ── 6. Otorisasi KEDUA tanpa nama — perilaku khas Apple ───────────────────
  // Kalau kode mengasumsikan `name` selalu ada, login kedua akan gagal.
  console.log('\n  ── 6. Otorisasi kedua TANPA nama (perilaku Apple) ──');
  const jar2 = buatJar();

  const mulai2 = await fetch(`${BASE}/api/auth/apple`, { redirect: 'manual' });
  jar2.simpan(mulai2);
  const lokasi2 = mulai2.headers.get('location') || '';
  const state2 = new URL(lokasi2).searchParams.get('state') || '';

  const izin2 = await fetch(lokasi2, { redirect: 'manual' });
  const html2 = await izin2.text();
  const cocokForm2 = html2.match(/<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/);
  const aksiForm2 = cocokForm2?.[1] || '';
  const isiForm2 = cocokForm2?.[2] || '';

  const code2 = (isiForm2.match(/name="code"\s+value="([^"]*)"/) || [])[1] || '';
  const adaUser2 = /name="user"/.test(isiForm2);

  cek('IdP TIDAK mengirim nama di otorisasi kedua', !adaUser2,
    adaUser2 ? 'nama masih dikirim — perilaku Apple tidak ditiru' : '');

  const cb2 = await fetch(aksiForm2, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(jar2.header() ? { Cookie: jar2.header() } : {}),
    },
    body: new URLSearchParams({ code: code2, state: state2 }),
    redirect: 'manual',
  });
  jar2.simpan(cb2);
  const lokasiCb2 = cb2.headers.get('location') || '';

  cek('login kedua tanpa nama TETAP berhasil',
    !lokasiCb2.includes('galat='), lokasiCb2.slice(0, 120));

  const profil2 = await fetch(`${BASE}/api/auth/profil`, {
    headers: jar2.header() ? { Cookie: jar2.header() } : {},
  });
  cek('sesi kedua terbit', profil2.status === 200, `status ${profil2.status}`);

  // ── 7. Keamanan: client_secret palsu DITOLAK ──────────────────────────────
  // Kalau IdP tiruan menerima secret sembarangan, uji ini tidak membuktikan
  // apa-apa. Kita pastikan verifikasinya benar-benar bekerja.
  console.log('\n  ── 7. IdP menolak client_secret palsu ──');
  const tolak = await fetch(`${IDP}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'code-palsu',
      client_id: 'id.vivastic.signin',
      client_secret: 'bukan-jwt-sama-sekali',
    }),
  });
  const dataTolak = await tolak.json().catch(() => ({}));
  cek('code palsu ditolak', tolak.status === 400, `status ${tolak.status}`);
  cek('alasan penolakan jelas', Boolean(dataTolak.error), JSON.stringify(dataTolak).slice(0, 80));

  // ── 8. Keamanan: code sekali pakai ────────────────────────────────────────
  console.log('\n  ── 8. Code tidak bisa dipakai dua kali ──');
  const pakaiUlang = await fetch(aksiForm, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyForm,
    redirect: 'manual',
  });
  const lokasiUlang = pakaiUlang.headers.get('location') || '';
  cek('code yang sudah dipakai ditolak',
    lokasiUlang.includes('galat=') || pakaiUlang.status >= 400,
    `status ${pakaiUlang.status} → ${lokasiUlang.slice(0, 80)}`);

  // ── 9. Keamanan: state palsu ditolak ──────────────────────────────────────
  console.log('\n  ── 9. State palsu ditolak ──');
  const statePalsu = await fetch(`${BASE}/api/auth/apple/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: 'code-apa-saja', state: 'state-palsu-12345' }),
    redirect: 'manual',
  });
  const lokasiPalsu = statePalsu.headers.get('location') || '';
  cek('state palsu ditolak',
    lokasiPalsu.includes('state') || statePalsu.status >= 400,
    `status ${statePalsu.status} → ${lokasiPalsu.slice(0, 90)}`);

  // ── Ringkasan ─────────────────────────────────────────────────────────────
  console.log(`\n  ${'═'.repeat(52)}`);
  console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
  console.log(`  ${'═'.repeat(52)}\n`);

  if (gagal > 0) process.exit(1);
}

uji().catch((e) => {
  console.error('  ❌ uji gagal total:', e.message, '\n', e.stack?.slice(0, 400));
  process.exit(1);
});
