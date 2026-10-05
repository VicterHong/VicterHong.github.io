/**
 * Uji scroll-spy — apakah nav benar-benar menandai section aktif?
 *
 * Mengukur dengan menggulir ke setiap section lalu memeriksa tautan mana
 * yang punya aria-current="true". Bukan sekadar "kodenya ada", tapi
 * "perilakunya benar".
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const URL_TARGET = process.argv[2] || 'https://portfolio-victer.pages.dev/home';
const PORT = 9260;

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`, '--window-size=1440,900',
  '--user-data-dir=/tmp/chrome-spy', 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());

let targets;
for (let i = 0; i < 20; i++) {
  await sleep(400);
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    if (targets.length) break;
  } catch { /* retry */ }
}

const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((r) => {
  const i = ++id; pending.set(i, r);
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise((r) => { ws.onopen = r; });

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: new URL(URL_TARGET).origin });
await sleep(2000);
await send('Runtime.evaluate', {
  expression: `try{sessionStorage.setItem('cf_clearance_'+location.hostname,String(Date.now()))}catch(e){}`,
});
await send('Page.navigate', { url: URL_TARGET });
await sleep(5000);

console.log('=== UJI SCROLL-SPY ===\n');

// Daftar section yang jadi target nav
const sections = await send('Runtime.evaluate', {
  expression: `(() => {
    const nav = document.querySelector('.site-nav');
    if (!nav) return JSON.stringify({error:'nav tidak ada'});
    const links = [...nav.querySelectorAll('a[href^="#"]')];
    return JSON.stringify(links.map(a => ({
      teks: a.textContent.trim(),
      id: a.getAttribute('href').slice(1),
      ada: !!document.getElementById(a.getAttribute('href').slice(1)),
    })));
  })()`, returnByValue: true,
});
const list = JSON.parse(sections.result.value);
if (list.error) { console.log('❌', list.error); process.exit(1); }

console.log('Section yang jadi target nav:');
for (const s of list) console.log(`  ${s.teks.padEnd(12)} #${s.id} ${s.ada ? '✅ ada' : '❌ TIDAK ADA'}`);
console.log('');

// Gulir ke setiap section dan periksa penanda
console.log('Menandai saat digulir:');
let benar = 0;
for (const s of list) {
  if (!s.ada) continue;
  const r = await send('Runtime.evaluate', {
    expression: `(async () => {
      const el = document.getElementById('${s.id}');
      if (!el) return JSON.stringify({error:'tidak ada'});

      // Matikan smooth-scroll dulu. Tanpa ini, scrollTop memicu animasi
      // halus yang butuh >600ms untuk jarak jauh — dan uji akan membaca
      // posisi di tengah animasi, bukan di tujuan.
      // Ini menonaktifkan animasi untuk UJI, bukan mengubah perilaku situs.
      const html = document.documentElement;
      const asli = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';

      // CATATAN: window.scrollTo() tidak bekerja di Chrome headless mode ini
      // (dibuktikan: scrollY tetap 0). documentElement.scrollTop bekerja.
      const y = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.2;
      html.scrollTop = Math.max(0, y);

      // Tunggu observer sempat jalan (IO async).
      //
      // Kalau halaman sudah MENTOK di bawah (section terakhir lebih pendek
      // dari viewport), scroll tidak mengubah posisi — dan IntersectionObserver
      // baru melaporkan setelah layout stabil. Beri waktu lebih, lalu picu
      // sekali lagi supaya IO pasti mengevaluasi ulang.
      await new Promise(r => setTimeout(r, 700));
      html.scrollTop = html.scrollTop; // paksa reflow
      await new Promise(r => setTimeout(r, 500));
      html.style.scrollBehavior = asli;

      const nav = document.querySelector('.site-nav');
      const aktif = [...nav.querySelectorAll('a[aria-current]')].map(a => a.textContent.trim());
      return JSON.stringify({ aktif, y: Math.round(window.scrollY) });
    })()`, awaitPromise: true, returnByValue: true,
  });
  const d = JSON.parse(r.result.value);
  const ok = d.aktif?.includes(s.teks);
  if (ok) benar++;
  console.log(`  ${s.teks.padEnd(12)} y=${String(d.y).padStart(5)}  aktif=[${(d.aktif ?? []).join(', ')}] ${ok ? '✅' : '❌'}`);
}

console.log('');
console.log(`Benar: ${benar} dari ${list.filter(s => s.ada).length}`);
console.log(benar === list.filter(s => s.ada).length
  ? '\n✅ SCROLL-SPY BEKERJA — setiap section ditandai dengan benar'
  : '\n❌ Ada section yang tidak ditandai dengan benar');

chrome.kill();
process.exit(benar === list.filter(s => s.ada).length ? 0 : 1);
