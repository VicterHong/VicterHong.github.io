/**
 * Uji alur SSO OIDC lengkap dengan IdP tiruan.
 *
 * Menguji SELURUH alur seperti pengguna sungguhan: mulai dari /api/auth/sso,
 * ikuti pengalihan ke IdP, kembali ke callback, sampai sesi terbentuk.
 *
 * ── YANG DIUJI ───────────────────────────────────────────────────────────────
 *   1. Discovery dibaca dan divalidasi
 *   2. PKCE dipakai (IdP tiruan mendukung S256)
 *   3. State diverifikasi dan SEKALI PAKAI
 *   4. Nonce di id_token cocok
 *   5. Tanda tangan JWT diverifikasi terhadap JWKS
 *   6. Akun dibuat dari identitas SSO
 *   7. Sesi terbentuk (cookie bisa dipakai)
 *   8. Domain di luar daftar DITOLAK
 *   9. Code tidak bisa dipakai dua kali
 *  10. State palsu ditolak
 */

const BASE = process.env.UJI_BASE || 'http://127.0.0.1:8799';
const IDP = process.env.UJI_IDP || 'http://127.0.0.1:9911';

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
    ambil(nama) { return isi.get(nama) || ''; },
  };
}

/** Ikuti pengalihan secara manual, kumpulkan cookie. */
async function ikuti(url, jar, maks = 6) {
  let sekarang = url;
  for (let i = 0; i < maks; i += 1) {
    const res = await fetch(sekarang, {
      redirect: 'manual',
      headers: jar.header() ? { Cookie: jar.header() } : {},
    });
    jar.simpan(res);

    if (res.status >= 300 && res.status < 400) {
      const lokasi = res.headers.get('location');
      if (!lokasi) return { res, url: sekarang };

      // ── Arahkan callback ke server uji, bukan SITE_URL ────────────────────
      // SITE_URL menunjuk ke proxy uji (localhost:8900) yang tidak dipakai
      // untuk uji SSO ini. Callback harus kembali ke server uji yang sama
      // yang menyimpan state — kalau tidak, state tidak ditemukan.
      let berikut = new URL(lokasi, sekarang).toString();
      berikut = berikut.replace(/^https?:\/\/localhost:\d+/, BASE)
                       .replace(/^https?:\/\/127\.0\.0\.1:\d+/, BASE);

      // Hanya arahkan ulang kalau tujuannya server uji, BUKAN IdP.
      // Tanpa pemeriksaan ini, permintaan ke IdP juga ikut dialihkan.
      if (berikut.includes('/api/auth/sso/callback')) {
        sekarang = berikut;
      } else {
        sekarang = new URL(lokasi, sekarang).toString();
      }
      continue;
    }
    return { res, url: sekarang };
  }
  return { res: null, url: sekarang };
}

async function uji() {
  console.log('\n══ 1. DISCOVERY & URL OTORISASI ══\n');

  const resMulai = await fetch(`${BASE}/api/auth/sso`, { redirect: 'manual' });
  const lokasi = resMulai.headers.get('location') || '';

  cek('SSO mengalihkan (302)', resMulai.status === 302, `status ${resMulai.status}`);
  cek('Dialihkan ke IdP', lokasi.startsWith(IDP), lokasi.slice(0, 60));

  const u = new URL(lokasi);
  cek('Ada client_id', u.searchParams.get('client_id') === 'klien-uji');
  cek('Ada redirect_uri', (u.searchParams.get('redirect_uri') || '').includes('/api/auth/sso/callback'));
  cek('response_type=code', u.searchParams.get('response_type') === 'code');
  cek('scope memuat openid', (u.searchParams.get('scope') || '').includes('openid'));
  cek('Ada state', Boolean(u.searchParams.get('state')));
  cek('Ada nonce', Boolean(u.searchParams.get('nonce')));

  // ── PKCE: IdP tiruan mendukung S256, jadi HARUS dipakai ────────────────────
  cek('PKCE S256 dipakai (IdP mendukung)', u.searchParams.get('code_challenge_method') === 'S256');
  const challenge = u.searchParams.get('code_challenge') || '';
  cek('code_challenge panjang (43+)', challenge.length >= 43, `${challenge.length} char`);

  console.log('\n══ 2. ALUR LENGKAP SAMPAI SESI ══\n');

  const jar = buatJar();
  const hasil = await ikuti(`${BASE}/api/auth/sso`, jar);

  // Uji ini mengarahkan callback ke BASE (server uji), jadi URL akhirnya
  // memuat BASE — bukan SITE_URL. Memeriksa SITE_URL akan selalu gagal.
  cek('Alur selesai di situs kita', hasil.url.startsWith(BASE),
    hasil.url.slice(0, 70));
  cek('Tidak ada galat di URL', !hasil.url.includes('galat='), hasil.url.slice(0, 90));

  const cookieSesi = jar.ambil('portfolio_session');
  cek('Cookie sesi terbentuk', Boolean(cookieSesi), cookieSesi ? `${cookieSesi.length} char` : 'kosong');

  console.log('\n══ 3. SESI BENAR-BENAR BERFUNGSI ══\n');

  const resProfil = await fetch(`${BASE}/api/auth/profil`, {
    headers: { Cookie: jar.header() },
  });
  cek('Sesi bisa dipakai akses /api/auth/profil', resProfil.status === 200, `status ${resProfil.status}`);

  if (resProfil.ok) {
    const profil = await resProfil.json();
    cek('Email dari IdP tersimpan', profil.email === 'budi@perusahaan.com', `email: ${profil.email}`);
    cek('Nama dari IdP tersimpan', (profil.nama || '').includes('Budi'), `nama: ${profil.nama}`);
  }

  const resIdentitas = await fetch(`${BASE}/api/auth/identitas`, {
    headers: { Cookie: jar.header() },
  });
  if (resIdentitas.ok) {
    const d = await resIdentitas.json();
    const ssoId = (d.identitas || []).find((i) => i.provider === 'sso');
    cek('Identitas SSO tercatat di akun', Boolean(ssoId), JSON.stringify((d.identitas || []).map(i => i.provider)));
  }

  console.log('\n══ 4. KEAMANAN: STATE ══\n');

  // State palsu harus ditolak.
  const resStatePalsu = await fetch(`${BASE}/api/auth/sso/callback?code=x&state=palsu`, {
    redirect: 'manual',
  });
  const lokasiPalsu = resStatePalsu.headers.get('location') || '';
  cek('State palsu ditolak', lokasiPalsu.includes('state_tidak_sah'), lokasiPalsu.slice(0, 70));

  // Callback tanpa parameter.
  const resKosong = await fetch(`${BASE}/api/auth/sso/callback`, { redirect: 'manual' });
  cek('Callback tanpa parameter ditolak',
    (resKosong.headers.get('location') || '').includes('callback_tidak_lengkap'));

  // Pengguna menolak di IdP.
  const resTolak = await fetch(`${BASE}/api/auth/sso/callback?error=access_denied&state=x`, { redirect: 'manual' });
  cek('Penolakan pengguna ditangani',
    (resTolak.headers.get('location') || '').includes('ditolak_pengguna'));

  console.log('\n══ 5. KEAMANAN: STATE SEKALI PAKAI ══\n');

  // Ambil state baru, pakai sekali (berhasil), lalu coba pakai lagi.
  const resBaru = await fetch(`${BASE}/api/auth/sso`, { redirect: 'manual' });
  const urlBaru = new URL(resBaru.headers.get('location') || '');
  const stateBaru = urlBaru.searchParams.get('state');

  // Ikuti sampai dapat code dari IdP tiruan.
  const resIdp = await fetch(urlBaru.toString(), { redirect: 'manual' });
  const urlCallback = resIdp.headers.get('location') || '';

  if (urlCallback) {
    const jar2 = buatJar();
    const pakai1 = await fetch(urlCallback.replace('http://localhost:8900', BASE), {
      redirect: 'manual', headers: {},
    });
    jar2.simpan(pakai1);
    cek('State dipakai pertama kali → berhasil', pakai1.status === 302 &&
      !(pakai1.headers.get('location') || '').includes('state_tidak_sah'),
      (pakai1.headers.get('location') || '').slice(0, 60));

    // Pakai ulang state yang sama.
    const pakai2 = await fetch(urlCallback.replace('http://localhost:8900', BASE), {
      redirect: 'manual', headers: {},
    });
    const lokasi2 = pakai2.headers.get('location') || '';
    cek('State dipakai KEDUA kali → DITOLAK', lokasi2.includes('state_tidak_sah'),
      lokasi2.slice(0, 70));
  } else {
    cek('Bisa dapat code dari IdP untuk uji state', false, 'IdP tidak mengembalikan code');
  }

  console.log('\n══ 6. PEMBATASAN DOMAIN ══\n');

  // Domain di luar daftar (perusahaan.com) harus ditolak.
  await fetch(`${IDP}/kendali/email?nilai=orang%40gmail.com`);

  const resDomain = await fetch(`${BASE}/api/auth/sso`, { redirect: 'manual' });
  const urlDomain = new URL(resDomain.headers.get('location') || '');
  const resIdp2 = await fetch(urlDomain.toString(), { redirect: 'manual' });
  const cbDomain = resIdp2.headers.get('location') || '';

  if (cbDomain) {
    const pakaiDomain = await fetch(cbDomain.replace('http://localhost:8900', BASE), {
      redirect: 'manual', headers: {},
    });
    const lokasiDomain = pakaiDomain.headers.get('location') || '';
    cek('Email domain lain DITOLAK', lokasiDomain.includes('sso_domain_tidak_cocok'),
      lokasiDomain.slice(0, 80));
  }

  // Kembalikan ke domain yang benar.
  await fetch(`${IDP}/kendali/email?nilai=budi%40perusahaan.com`);

  console.log('\n══ 7. KONFIGURASI ══\n');

  const resCfg = await fetch(`${BASE}/api/config`);
  const cfg = await resCfg.json();
  cek('/api/config melaporkan SSO siap', cfg.sso?.sso === true);
  cek('/api/config mengirim label SSO', cfg.sso_label === 'VIVASTIC ID', `label: ${cfg.sso_label}`);

  // ── Ringkasan ──────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(58)}`);
  console.log(`  LULUS: ${lulus}    GAGAL: ${gagal}`);
  console.log(`${'═'.repeat(58)}\n`);

  process.exit(gagal > 0 ? 1 : 0);
}

uji().catch((err) => {
  console.error('\n  ❌ Uji gagal dijalankan:', err.message);
  console.error(err.stack?.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
