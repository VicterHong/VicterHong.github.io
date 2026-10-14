/**
 * UJI ATURAN BARU: 3 proyek dari login + 2 dari star = 5.
 *
 * ── KENAPA PAKAI DATABASE SUNGGUHAN ──────────────────────────────────────────
 * Aturan ini bergantung pada UNIQUE(user_id, project_slug) di tabel
 * metrik_terbuka. Mock yang "selalu menerima INSERT" akan meloloskan tes yang
 * seharusnya gagal — dan yang lolos itu adalah pengguna memakai satu jatah
 * berkali-kali.
 */
import { openDb, getDb } from '../src/db.mjs';

openDb(':memory:');
const akses = await import('../src/akses-proyek.mjs');
const { KUOTA_METRIK_GRATIS, TOTAL_METRIK_GRATIS } = await import('../src/langganan.mjs');

const USER = 'u-alur';
const PROYEK = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

let lulus = 0, gagal = 0;
function periksa(nama, benar, detail = '') {
  if (benar) { lulus++; console.log(`  ✓ ${nama}`); }
  else { gagal++; console.log(`  ✗ ${nama}${detail ? ' — ' + detail : ''}`); }
}

console.log('── 1. SEBELUM STAR: 3 PROYEK PERTAMA ──');
{
  for (let i = 0; i < 3; i++) {
    const r = akses.periksaAksesMetrik(USER, PROYEK[i], { sudahStar: false });
    periksa(`proyek ke-${i + 1} boleh dibuka tanpa star`, r.boleh === true, JSON.stringify(r));
    periksa(`  sumbernya "${r.sumber}"`, r.sumber === 'login');
  }
  periksa('tercatat 3 proyek', akses.jumlahMetrikTerbuka(USER) === 3,
    `tercatat ${akses.jumlahMetrikTerbuka(USER)}`);
}

console.log('\n── 2. PROYEK KE-4 DITOLAK, TAPI ADA JALAN KELUAR ──');
{
  const r = akses.periksaAksesMetrik(USER, PROYEK[3], { sudahStar: false });
  periksa('proyek ke-4 ditolak', r.boleh === false);
  periksa('alasannya menyebut star', r.alasan === 'jatah-habis-bisa-star', r.alasan);
  periksa('tetap 3 proyek tercatat', akses.jumlahMetrikTerbuka(USER) === 3);

  const pesan = akses.pesanTolak(r.alasan, { jatahTotal: 3 });
  periksa('pesannya menyebut cara menambah', /star/i.test(pesan), pesan);
}

console.log('\n── 3. SETELAH STAR: 2 PROYEK LAGI ──');
{
  // Klaim star
  getDb().prepare(`
    INSERT INTO bonus_star (id, user_id, paket_saat_itu, sumber, github_user, diberikan_at, catatan)
    VALUES ('bs-1', ?, 'gratis', 'github', 'ujites', ?, '')
  `).run(USER, Date.now());

  for (const i of [3, 4]) {
    const r = akses.periksaAksesMetrik(USER, PROYEK[i], { sudahStar: true });
    periksa(`proyek ke-${i + 1} boleh setelah star`, r.boleh === true, JSON.stringify(r));
    periksa(`  sumbernya "${r.sumber}"`, r.sumber === 'star');
  }
  periksa(`total ${TOTAL_METRIK_GRATIS} proyek tercatat`, akses.jumlahMetrikTerbuka(USER) === 5,
    `tercatat ${akses.jumlahMetrikTerbuka(USER)}`);
}

console.log('\n── 4. PROYEK KE-6 DITOLAK, TANPA JALAN GRATIS ──');
{
  const r = akses.periksaAksesMetrik(USER, PROYEK[5], { sudahStar: true });
  periksa('proyek ke-6 ditolak', r.boleh === false);
  periksa('alasannya tidak menyebut star lagi', r.alasan === 'jatah-habis', r.alasan);

  const pesan = akses.pesanTolak(r.alasan, { jatahTotal: 5 });
  periksa('pesannya menyebut berlangganan', /berlangganan/i.test(pesan), pesan);
  periksa('pesannya TIDAK menyuruh star lagi', !/beri star/i.test(pesan), pesan);
}

console.log('\n── 5. PROYEK YANG SUDAH DIBUKA TETAP TERBUKA ──');
{
  for (const s of ['p1', 'p3', 'p5']) {
    const r = akses.periksaAksesMetrik(USER, s, { sudahStar: true });
    periksa(`${s} masih boleh dibuka walau jatah habis`, r.boleh === true);
    periksa(`  tidak memakai jatah lagi`, r.pakaiJatah === false);
  }
  periksa('tetap 5 proyek tercatat', akses.jumlahMetrikTerbuka(USER) === 5,
    `tercatat ${akses.jumlahMetrikTerbuka(USER)}`);
}

console.log('\n── 6. MEMBUKA PROYEK YANG SAMA BERULANG TIDAK MENAMBAH ──');
{
  for (let i = 0; i < 5; i++) akses.periksaAksesMetrik(USER, 'p1', { sudahStar: true });
  periksa('tetap 5 baris, tidak menumpuk', akses.jumlahMetrikTerbuka(USER) === 5,
    `tercatat ${akses.jumlahMetrikTerbuka(USER)}`);
}

console.log('\n── 7. KEADAAN METRIK UNTUK UI ──');
{
  const k = akses.keadaanMetrik(USER);
  periksa('total = 5', k.total === 5, `total ${k.total}`);
  periksa('terpakai = 5', k.terpakai === 5, `terpakai ${k.terpakai}`);
  periksa('sisa = 0', k.sisa === 0, `sisa ${k.sisa}`);
  periksa('sudahStar = true', k.sudahStar === true);
  periksa('bonusStarTersedia = 0', k.bonusStarTersedia === 0);
  periksa('daftar 5 proyek', k.proyek.length === 5, JSON.stringify(k.proyek));
}

console.log('\n── 8. PENGGUNA BARU: ANGKA AWALNYA BENAR ──');
{
  const k = akses.keadaanMetrik('u-baru');
  periksa('total = 3 (belum star)', k.total === 3, `total ${k.total}`);
  periksa('sisa = 3', k.sisa === 3);
  periksa('bonusStarTersedia = 2', k.bonusStarTersedia === 2);
  periksa('belum ada proyek terbuka', k.proyek.length === 0);
}

console.log('\n── 9. PAKET BERBAYAR TIDAK TERSENTUH ──');
{
  const USER2 = 'u-bayar';
  getDb().prepare(`
    INSERT INTO langganan (id, user_id, paket, periode, mulai_at, selesai_at, status, dibuat_at)
    VALUES ('l-2', ?, 'standar', 'bulanan', ?, NULL, 'aktif', ?)
  `).run(USER2, Date.now(), Date.now());

  for (const s of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) {
    const r = akses.periksaAksesMetrik(USER2, s, { sudahStar: false });
    periksa(`berbayar: ${s} boleh`, r.boleh === true);
  }
  periksa('berbayar tidak memakai jatah gratis', akses.jumlahMetrikTerbuka(USER2) === 0,
    `tercatat ${akses.jumlahMetrikTerbuka(USER2)}`);

  const k = akses.keadaanMetrik(USER2);
  periksa('berbayar: total null (tanpa batas)', k.total === null);
}

console.log(`\n${'─'.repeat(52)}`);
console.log(gagal === 0
  ? `✅ SEMUA LULUS — ${lulus} pemeriksaan`
  : `❌ ${gagal} GAGAL dari ${lulus + gagal} pemeriksaan`);
process.exitCode = gagal === 0 ? 0 : 1;
