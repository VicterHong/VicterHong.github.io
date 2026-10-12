/**
 * Kerangka HTML email — satu sumber untuk SEMUA template.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA TABEL, BUKAN DIV + FLEXBOX ────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Outlook untuk Windows memakai mesin render Microsoft Word — bukan browser.
 * Word tidak mengenal flexbox, grid, atau bahkan banyak aturan CSS modern.
 * Yang ia pahami: TABEL.
 *
 * Karena itu setiap klien email profesional memakai `<table role="presentation">`
 * untuk tata letak. `role="presentation"` memberi tahu pembaca layar bahwa
 * tabel ini murni visual — bukan tabel data — sehingga pengguna screen reader
 * tidak mendengar "tabel dengan 3 kolom" sebelum setiap paragraf.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── KENAPA SEMUA GAYA INLINE ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Gmail memotong tag <style> di <head> untuk sebagian konfigurasi. Kalau warna
 * dan jarak ditulis di sana, email sampai dalam keadaan tanpa gaya — teks hitam
 * di latar putih, tombol jadi tautan biru polos.
 *
 * Semua gaya karena itu ditulis sebagai atribut `style=""` pada elemennya
 * masing-masing. Hasilnya lebih bertele-tele, tapi konsisten di semua klien.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── LEBAR 600px ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 600px adalah lebar standar email transaksional (Stripe, GitHub, Vercel semua
 * memakainya). Di bawah itu, konten terasa sempit di desktop. Di atasnya,
 * Gmail di desktop mulai memotong sisi kanan.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── PREHEADER ────────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Teks yang muncul di daftar masuk SETELAH subjek — "Kode Anda: 123456 · Berlaku
 * 15 menit". Tanpa preheader, klien email menampilkan kalimat pertama body
 * ("Halo Victer,") yang tidak informatif.
 *
 * Caranya: elemen tersembunyi di paling atas, disusul karakter tak terlihat
 * untuk mencegah klien menarik teks lain ke area pratinjau.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ── MODE GELAP ───────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Email ini memang dirancang gelap (sesuai situs). Tapi beberapa klien
 * (Outlook mobile, Gmail Android) MEMBALIK warna secara otomatis kalau tidak
 * diberi tahu — hasilnya teks gelap di latar gelap, tidak terbaca.
 *
 * `color-scheme` + `supported-color-schemes` memberi tahu klien bahwa email ini
 * sudah punya skema sendiri dan tidak perlu dibalik.
 */

// ── Palet ─────────────────────────────────────────────────────────────────────
// Sama dengan situs (assets/css/main.css) supaya email dan halaman web terasa
// satu produk. Diambil dari variabel CSS: --accent, --bg, --bg-card, dll.
//
// ── KENAPA teksSamar LEBIH TERANG DARI DI SITUS ──────────────────────────────
// Di situs, --text-faint (#8a8a94) dipakai untuk teks yang boleh samar karena
// pengguna bisa memperbesar halaman. Di email tidak bisa: ukurannya terkunci
// 12px, dan latar kartu (#16161a) lebih gelap dari latar situs. Rasio
// kontrasnya mepet batas WCAG AA (4.5:1) — di layar ponsel dengan kecerahan
// rendah, teks footer jadi tidak terbaca.
//
// #9d9da8 menaikkan rasio ke ~6:1: masih terlihat sebagai teks sekunder,
// tapi tetap terbaca di semua kondisi.
export const WARNA = {
  latar: '#0a0a0b',        // --bg
  kartu: '#16161a',        // --bg-card
  kartuLembut: '#121214',  // --bg-soft
  garis: '#26262c',        // --line
  garisLembut: '#1e1e23',  // --line-soft
  teks: '#f4f4f6',         // --text
  teksRedup: '#a1a1aa',    // --text-dim
  teksSamar: '#9d9da8',    // lebih terang dari --text-faint, alasan di atas
  emas: '#f5c542',         // --accent
  emasTerang: '#f7d77a',   // --accent-light
  hijau: '#34d399',        // status sukses
  merah: '#f87171',        // status bahaya
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/**
 * Karakter tak terlihat untuk mengisi area pratinjau setelah preheader.
 *
 * Tanpa ini, klien email menarik kalimat berikutnya dari body ke area
 * pratinjau — dan yang muncul seringkali "Halo," atau bahkan kode HTML.
 * `&#847;` adalah "combining grapheme joiner", tak terlihat dan tidak
 * memengaruhi pembaca layar.
 */
const PENGISI = '&#847;&zwnj;&nbsp;'.repeat(40);

/**
 * Tombol yang aman di Outlook.
 *
 * Outlook tidak menghormati `padding` pada elemen `<a>`. Solusinya: bungkus
 * tautan dalam tabel satu sel, dan taruh padding di sel itu. Inilah pola
 * "bulletproof button" yang dipakai semua email transaksional besar.
 *
 * ── KENAPA LEBAR TOMBOL DIBATASI (bukan dibiarkan penuh) ─────────────────────
 * Tombol dengan `display:block` akan memenuhi lebar kartu — dan label pendek
 * seperti "Lihat pesanan" lalu tampak sebagai pil raksasa yang sebagian besar
 * isinya ruang kosong. Itu terlihat seperti template, bukan desain.
 *
 * Solusinya: `display:inline-block` di dalam sel yang `text-align:left`.
 * Lebarnya mengikuti panjang label + padding, jadi tombol pendek tetap
 * proporsional dan tombol panjang ("Buka pengaturan keamanan") tidak
 * terpotong.
 *
 * ── UKURAN SENTUH ────────────────────────────────────────────────────────────
 * Padding 15px vertikal memberi tinggi ~48px — di atas ambang 44px yang
 * direkomendasikan Apple dan Google. Tombol yang lebih pendek membuat
 * pengguna salah tekan, terutama saat membuka email sambil berjalan.
 */
export function tombol({ teks, url, warna = WARNA.emas, warnaTeks = '#0a0a0b' }) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px">
    <tr>
      <td align="left">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
          href="${url}" style="height:48px;v-text-anchor:middle;width:240px" arcsize="17%" stroke="f" fillcolor="${warna}">
          <w:anchorlock/>
          <center style="color:${warnaTeks};font-family:${FONT};font-size:15px;font-weight:600">${teks}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-- -->
        <a href="${url}"
           style="display:inline-block;padding:15px 30px;background:${warna};color:${warnaTeks};font-family:${FONT};font-size:15px;font-weight:600;line-height:18px;text-decoration:none;border-radius:8px">
          ${teks}
        </a>
        <!--<![endif]-->
      </td>
    </tr>
  </table>`;
}

/**
 * Kotak kode — untuk OTP dan kode verifikasi.
 *
 * Angka dipisah spasi dan memakai huruf monospace berukuran besar: lebih mudah
 * dibaca sekilas sambil berpindah aplikasi, dan tidak salah ketik.
 * `letter-spacing` ditambah supaya antar-angka tidak menempel.
 */
export function kotakKode(kode) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
    <tr>
      <td align="center" bgcolor="${WARNA.kartuLembut}"
          style="border:1px solid ${WARNA.garis};border-radius:10px;padding:20px 16px">
        <div style="font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${WARNA.emas};line-height:1">
          ${kode}
        </div>
      </td>
    </tr>
  </table>`;
}

/**
 * Baris detail — untuk struk pembayaran (label kiri, nilai kanan).
 *
 * Memakai tabel dua kolom, BUKAN flexbox: Outlook tidak mengenal flexbox, dan
 * label/nilai akan bertumpuk tanpa pemisah.
 *
 * ── KENAPA ADA GARIS PEMISAH ANTAR BARIS ─────────────────────────────────────
 * Tanpa pemisah, mata harus menelusuri dari label paling kiri ke nilai paling
 * kanan untuk setiap baris — dan pada baris keempat atau kelima, mudah
 * tersesat ke baris yang salah. Itu masalah nyata pada struk: pengguna sedang
 * memeriksa angka, dan salah baca berarti salah paham soal tagihan.
 *
 * Garis tipis (1px, warna lebih gelap dari latar) memandu mata tanpa
 * menambah berat visual. Baris terakhir tidak diberi garis — tidak ada yang
 * perlu dipisahkan di bawahnya.
 */
export function barisDetail(baris) {
  const isi = baris.map(([label, nilai], i) => {
    const garis = i === 0 ? '' : `border-top:1px solid ${WARNA.garisLembut};`;
    return `
    <tr>
      <td style="${garis}padding:11px 0 0;font-family:${FONT};font-size:14px;color:${WARNA.teksSamar};vertical-align:top;width:45%">${label}</td>
      <td style="${garis}padding:11px 0 0;font-family:${FONT};font-size:14px;color:${WARNA.teks};text-align:right;vertical-align:top">${nilai}</td>
    </tr>`;
  }).join('');

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="margin:0 0 24px;border:1px solid ${WARNA.garis};border-radius:10px">
    <tr>
      <td style="padding:18px 20px">${isi}</td>
    </tr>
  </table>`;
}

/**
 * Kotak sorotan — untuk peringatan keamanan atau catatan penting.
 *
 * @param {string} jenis - 'info' | 'peringatan' | 'sukses'
 */
export function kotakCatatan({ teks, jenis = 'info' }) {
  const gaya = {
    info: { garis: WARNA.garis, latar: WARNA.kartuLembut, aksen: WARNA.teksSamar },
    peringatan: { garis: '#7c2d12', latar: '#1c1210', aksen: WARNA.merah },
    sukses: { garis: '#064e3b', latar: '#0f1a17', aksen: WARNA.hijau },
  }[jenis] ?? { garis: WARNA.garis, latar: WARNA.kartuLembut, aksen: WARNA.teksSamar };

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
    <tr>
      <td bgcolor="${gaya.latar}" style="border-left:3px solid ${gaya.aksen};border-radius:6px;padding:14px 16px">
        <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${WARNA.teksRedup}">${teks}</p>
      </td>
    </tr>
  </table>`;
}

/** Paragraf standar. */
export function p(teks, { redup = false, margin = '0 0 16px' } = {}) {
  return `<p style="margin:${margin};font-family:${FONT};font-size:15px;line-height:1.65;color:${redup ? WARNA.teksSamar : WARNA.teksRedup}">${teks}</p>`;
}

/**
 * Kerangka lengkap satu email.
 *
 * @param {object} opsi
 * @param {string} opsi.judul      - judul besar (h1)
 * @param {string} opsi.preheader  - teks pratinjau di daftar masuk
 * @param {string} opsi.isi        - HTML bagian tengah
 * @param {string} [opsi.catatanKaki] - kalimat tambahan sebelum footer
 */
export function bungkus({ judul, preheader, isi, catatanKaki = '' }) {
  // ── KENAPA DOMAIN PROFESIONAL, BUKAN pages.dev ─────────────────────────────
  // Email dikirim dari `noreply@victer.is-a.dev`. Kalau tautan di dalamnya
  // menuju `portfolio-victer.pages.dev`, penerima melihat dua domain berbeda
  // — dan itu pola yang sama dengan email phishing (pengirim satu domain,
  // tautan ke domain lain).
  //
  // Penerima yang waspada akan curiga, dan filter spam memberi nilai lebih
  // rendah. Satu domain untuk pengirim DAN tautan adalah syarat dasar email
  // transaksional yang bisa dipercaya.
  const dasar = 'https://victer.is-a.dev';
  const tahun = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="id" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${judul}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:${WARNA.latar};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">

  <!-- Preheader: tampil di daftar masuk, tersembunyi di dalam email -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">
    ${preheader}${PENGISI}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WARNA.latar}">
    <tr>
      <td align="center" style="padding:40px 16px">

        <!-- Kartu utama, lebar 600px (standar email transaksional) -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
               style="width:100%;max-width:600px;background:${WARNA.kartu};border:1px solid ${WARNA.garis};border-radius:14px">

          <!-- Kepala: logo + nama -->
          <tr>
            <td style="padding:28px 32px 0">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align:middle">
                    <!--
                      ── LOGO: GAMBAR PNG, DENGAN CADANGAN TEKS ─────────────────
                      Beberapa klien email MEMBLOKIR gambar secara default
                      (Outlook sering, Gmail untuk pengirim baru). Kalau logo
                      hanya gambar, kepala email jadi kosong — terlihat rusak.

                      Karena itu logo dibungkus sel ber-latar emas yang berisi
                      huruf "V". Kalau gambar dimuat, ia menutupi huruf itu.
                      Kalau tidak, huruf "V" tetap muncul dan kepala email
                      tetap utuh.

                      Atribut alt sengaja DIKOSONGKAN: pembaca layar tidak
                      perlu membacakan "logo" sebelum nama perusahaan — nama
                      itu ada di sebelahnya.
                    -->
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="36" height="36" bgcolor="${WARNA.emas}"
                            style="width:36px;height:36px;border-radius:10px;text-align:center;vertical-align:middle;font-family:${FONT};font-size:18px;font-weight:700;color:#0a0a0b;line-height:36px">
                          <img src="${dasar}/assets/img/vivastic-mark-72.png"
                               width="36" height="36" alt=""
                               style="display:block;width:36px;height:36px;border:0;border-radius:10px;outline:none;text-decoration:none">
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="padding-left:12px;vertical-align:middle">
                    <div style="font-family:${FONT};font-size:15px;font-weight:600;color:${WARNA.teks};letter-spacing:0.06em">VIVASTIC</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Isi -->
          <tr>
            <td style="padding:28px 32px 8px">
              <h1 style="margin:0 0 20px;font-family:${FONT};font-size:23px;font-weight:600;line-height:1.3;color:${WARNA.teks};letter-spacing:-0.02em">${judul}</h1>
              ${isi}
            </td>
          </tr>

          <!-- Catatan kaki dalam kartu -->
          <tr>
            <td style="padding:8px 32px 28px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid ${WARNA.garisLembut};padding-top:20px">
                  ${catatanKaki ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.6;color:${WARNA.teksSamar}">${catatanKaki}</p>` : ''}
                  <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${WARNA.teksSamar}">
                    Email otomatis dari VIVASTIC. Pesan ini dikirim karena ada aktivitas pada akun Anda — mohon jangan dibalas.
                  </p>
                </td></tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Kartu utama -->

        <!-- Kaki halaman di luar kartu -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
               style="width:100%;max-width:600px">
          <tr>
            <td style="padding:28px 32px 0;text-align:center">
              <!--
                ── TAGLINE BRAND ────────────────────────────────────────────────
                Satu baris pendek di bawah kartu memberi email "kepribadian" —
                pembeda antara email yang dirancang dan template yang dipakai
                apa adanya. Diletakkan di footer (bukan atas) supaya tidak
                bersaing dengan isi utama.
              -->
              <p style="margin:0 0 14px;font-family:${FONT};font-size:12px;line-height:1.6;color:${WARNA.teksSamar};letter-spacing:0.02em">
                Layanan pengembangan perangkat lunak
              </p>
              <p style="margin:0 0 14px;font-family:${FONT};font-size:12px;line-height:1.6;color:${WARNA.teksSamar}">
                <a href="${dasar}/docs" style="color:${WARNA.teksRedup};text-decoration:underline">Panduan</a>
                &nbsp;·&nbsp;
                <a href="${dasar}/privasi" style="color:${WARNA.teksRedup};text-decoration:underline">Kebijakan privasi</a>
                &nbsp;·&nbsp;
                <a href="${dasar}/keamanan" style="color:${WARNA.teksRedup};text-decoration:underline">Keamanan</a>
              </p>
              <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${WARNA.teksSamar}">
                © ${tahun} VIVASTIC
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}

/**
 * Versi teks polos — WAJIB ada, bukan pelengkap.
 *
 * Tiga alasan:
 *   1. Sebagian klien hanya menampilkan teks; email tanpa versi teks tampak
 *      rusak di sana.
 *   2. Filter spam memberi nilai lebih untuk email yang punya kedua versi.
 *   3. Pengguna dengan pembaca layar lebih memilih versi teks.
 */
export function versiTeks({ judul, baris }) {
  const garis = '─'.repeat(46);
  return [
    judul.toUpperCase(),
    garis,
    '',
    ...baris,
    '',
    garis,
    'Email otomatis dari VIVASTIC — mohon jangan dibalas.',
    'Bantuan: https://victer.is-a.dev/bantuan',
  ].join('\n');
}
