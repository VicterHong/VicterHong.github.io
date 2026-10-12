/**
 * Changelog — memuat changelog.json, merender daftar rilis per tanggal,
 * plus penyaring kategori dan navigasi panel geser di mobile.
 *
 * ── KENAPA DATA DIPISAH (JSON), BUKAN DI DALAM HTML ─────────────────────────
 * Riwayat proyek ini 338 perubahan. Menaruhnya di HTML berarti setiap halaman
 * membawa ~40 KB teks yang mungkin tidak dibaca. JSON dimuat terpisah, dan
 * halaman bisa menampilkan kerangka dulu (tidak ada layar kosong).
 *
 * ── KENAPA PENYARING, BUKAN CUMA DAFTAR ─────────────────────────────────────
 * 338 baris sulit dipindai. Penyaring "Fitur baru saja" mengubahnya jadi
 * belasan baris — itu yang biasanya dicari pengunjung changelog.
 */
(function () {
  'use strict';

  var daftar = document.getElementById('clDaftar');
  var skeleton = document.getElementById('clSkeleton');
  var kosong = document.getElementById('clKosong');
  var ringkas = document.getElementById('clRingkas');
  var filterWadah = document.getElementById('clFilter');
  var tanggalNav = document.getElementById('clTanggalNav');

  if (!daftar) return;

  // ── Panel geser (mekanisme sama dengan halaman Panduan) ────────────────────
  var navBuka = document.getElementById('clNavBuka');
  var navScrim = document.getElementById('clNavScrim');
  var sidebar = document.getElementById('clSidebar');

  function bukaPanel() {
    if (!sidebar || !navScrim || !navBuka) return;
    sidebar.classList.add('is-terbuka');
    navScrim.classList.add('is-tampil');
    navBuka.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function tutupPanel(kembalikanFokus) {
    if (!sidebar || !navScrim || !navBuka) return;
    sidebar.classList.remove('is-terbuka');
    navScrim.classList.remove('is-tampil');
    navBuka.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (kembalikanFokus) navBuka.focus();
  }

  if (navBuka && navScrim && sidebar) {
    navBuka.addEventListener('click', function () {
      if (sidebar.classList.contains('is-terbuka')) tutupPanel(true);
      else bukaPanel();
    });
    navScrim.addEventListener('click', function () { tutupPanel(true); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar.classList.contains('is-terbuka')) {
        e.preventDefault();
        tutupPanel(true);
      }
    });
    // Layar diperbesar ke desktop saat panel terbuka → bersihkan keadaan.
    var mq = window.matchMedia('(min-width: 901px)');
    var tangani = function (e) { if (e.matches) tutupPanel(false); };
    if (mq.addEventListener) mq.addEventListener('change', tangani);
    else if (mq.addListener) mq.addListener(tangani);
  }

  // ── Muat data ──────────────────────────────────────────────────────────────
  fetch('/changelog.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) { mulai(data); })
    .catch(function () {
      if (skeleton) skeleton.hidden = true;
      if (ringkas) ringkas.textContent = 'Gagal memuat riwayat. Muat ulang halaman.';
    });

  // ── Tanggal → format Indonesia ─────────────────────────────────────────────
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
               'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  function formatTanggal(iso) {
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    var tgl = parseInt(p[2], 10);
    var bln = parseInt(p[1], 10) - 1;
    return tgl + ' ' + (BULAN[bln] || p[1]) + ' ' + p[0];
  }

  /** Jarak hari dari hari ini — "hari ini", "kemarin", atau jumlah hari. */
  function jarakHari(iso) {
    var bagian = iso.split('-');
    var d = new Date(Number(bagian[0]), Number(bagian[1]) - 1, Number(bagian[2]));
    var kini = new Date();
    kini.setHours(0, 0, 0, 0);
    var selisih = Math.round((kini - d) / 86400000);
    if (selisih <= 0) return 'hari ini';
    if (selisih === 1) return 'kemarin';
    if (selisih < 7) return selisih + ' hari lalu';
    if (selisih < 30) return Math.round(selisih / 7) + ' minggu lalu';
    return Math.round(selisih / 30) + ' bulan lalu';
  }

  // ── Mulai ──────────────────────────────────────────────────────────────────
  function mulai(data) {
    if (skeleton) skeleton.hidden = true;

    if (ringkas) {
      ringkas.textContent =
        data.totalDicatat + ' perubahan dari ' + data.totalCommit + ' commit, ' +
        formatTanggal(data.hariPertama) + ' → ' + formatTanggal(data.hariTerakhir) + '.';
    }

    // Kumpulkan kategori yang benar-benar ada di data — jangan tampilkan
    // penyaring untuk kategori kosong.
    var kategoriAda = {};
    data.rilis.forEach(function (r) {
      r.kategori.forEach(function (k) { kategoriAda[k.kunci] = k.label; });
    });

    var saring = 'semua';

    // ── Penyaring ────────────────────────────────────────────────────────────
    if (filterWadah) {
      var opsi = [['semua', 'Semua']].concat(
        Object.keys(kategoriAda).map(function (k) { return [k, kategoriAda[k]]; })
      );

      opsi.forEach(function (o) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cl-filter-item';
        b.dataset.kunci = o[0];
        b.textContent = o[1];
        if (o[0] === 'semua') b.classList.add('is-aktif');
        b.addEventListener('click', function () {
          saring = o[0];
          filterWadah.querySelectorAll('.cl-filter-item').forEach(function (x) {
            x.classList.toggle('is-aktif', x === b);
          });
          render();
          // Setelah memilih di panel mobile, tutup supaya hasilnya terlihat.
          if (sidebar && sidebar.classList.contains('is-terbuka')) tutupPanel(false);
        });
        filterWadah.appendChild(b);
      });
    }

    // ── Navigasi tanggal di sidebar ──────────────────────────────────────────
    if (tanggalNav) {
      data.rilis.forEach(function (r) {
        var a = document.createElement('a');
        a.className = 'cl-nav-tanggal';
        a.href = '#tgl-' + r.tanggal;
        a.innerHTML = '<span class="cl-nav-hari">' + formatTanggal(r.tanggal) + '</span>' +
                      '<span class="cl-nav-jumlah">' + r.jumlah + '</span>';
        a.addEventListener('click', function () {
          if (sidebar && sidebar.classList.contains('is-terbuka')) tutupPanel(false);
        });
        tanggalNav.appendChild(a);
      });
    }

    // Jumlah di tombol buka panel
    var jumlah = document.getElementById('clNavJumlah');
    if (jumlah) jumlah.textContent = data.rilis.length + ' tanggal';

    // ── Render ───────────────────────────────────────────────────────────────
    function render() {
      daftar.innerHTML = '';
      var totalTampil = 0;

      data.rilis.forEach(function (r) {
        var kategori = r.kategori.filter(function (k) {
          return saring === 'semua' || k.kunci === saring;
        });
        if (!kategori.length) return;

        totalTampil++;

        var seksi = document.createElement('section');
        seksi.className = 'cl-hari';
        seksi.id = 'tgl-' + r.tanggal;

        var kepala = document.createElement('div');
        kepala.className = 'cl-hari-kepala';
        kepala.innerHTML =
          '<h2 class="cl-hari-tanggal">' + formatTanggal(r.tanggal) + '</h2>' +
          '<span class="cl-hari-jarak">' + jarakHari(r.tanggal) + '</span>' +
          '<span class="cl-hari-jumlah">' + r.jumlah + ' perubahan</span>';
        seksi.appendChild(kepala);

        kategori.forEach(function (k) {
          var blok = document.createElement('div');
          blok.className = 'cl-kategori cl-kategori-' + k.kunci;

          var judul = document.createElement('h3');
          judul.className = 'cl-kategori-judul';
          judul.innerHTML = '<span class="cl-tanda" aria-hidden="true"></span>' + k.label;
          blok.appendChild(judul);

          var ul = document.createElement('ul');
          ul.className = 'cl-daftar';

          k.item.forEach(function (it) {
            var li = document.createElement('li');
            li.className = 'cl-item';

            var teks = document.createElement('span');
            teks.className = 'cl-item-teks';
            if (it.scope) {
              var scope = document.createElement('span');
              scope.className = 'cl-scope';
              scope.textContent = it.scope;
              teks.appendChild(scope);
            }
            teks.appendChild(document.createTextNode(it.teks));

            var kode = document.createElement('code');
            kode.className = 'cl-hash';
            kode.textContent = it.hash;
            kode.title = 'Commit ' + it.hash;

            li.appendChild(teks);
            li.appendChild(kode);
            ul.appendChild(li);
          });

          blok.appendChild(ul);
          seksi.appendChild(blok);
        });

        daftar.appendChild(seksi);
      });

      if (kosong) kosong.hidden = totalTampil > 0;
    }

    render();
  }
})();
