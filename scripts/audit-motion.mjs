/**
 * Audit gerak nyata (Batch 3) — mengukur RESPONS, bukan sekadar keberadaan.
 *
 * ── KENAPA INI PERLU ────────────────────────────────────────────────────────
 *
 * Audit desain (Luna) menulis: "transisi dan gerak belum bisa dinilai dari
 * screenshot statis." Itu benar. Tapi ada bagian yang BISA diukur secara
 * objektif, dan itu yang dilakukan skrip ini:
 *
 *   1. Apakah elemen interaktif MERESPONS hover/press/focus?
 *   2. Berapa LAMA responsnya (harus 120-200ms untuk terasa langsung)?
 *   3. Apakah focus state TERLIHAT (WCAG 2.4.7 — wajib)?
 *   4. Apakah ada elemen yang dianimasikan lewat properti LAYOUT
 *      (width/height/top/left) — itu memicu reflow dan mahal?
 *   5. Apakah ada animasi yang berjalan TERUS-MENERUS tanpa henti?
 *
 * Yang TIDAK bisa diukur skrip: apakah geraknya terasa NYAMAN. Itu butuh
 * mata dan tangan manusia. Skrip ini menyaring masalah objektif dulu,
 * supaya penilaian manusia fokus pada hal yang benar-benar subjektif.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome`;
const URL_TARGET = process.argv[2] || 'https://portfolio-victer.pages.dev/home';
const PORT = 9270;

const chrome = spawn(CHROME, [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`, '--window-size=1440,900',
  '--user-data-dir=/tmp/chrome-motion-audit', 'about:blank',
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

// ── 1. Transisi pada elemen interaktif ─────────────────────────────────────
const r1 = await send('Runtime.evaluate', {
  expression: `(() => {
    const sels = ['a', 'button', '.btn', '.chip', '.project', 'input', 'select', 'textarea'];
    const out = [];
    const seen = new Set();
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        const props = cs.transitionProperty.split(',').map(s => s.trim());
        const durs = cs.transitionDuration.split(',').map(s => s.trim());
        const delay = cs.transitionDelay.split(',').map(s => s.trim());

        // Cari durasi efektif (yang bukan 0s)
        const durMs = durs.map(d => {
          const n = parseFloat(d);
          return d.endsWith('ms') ? n : n * 1000;
        }).filter(n => n > 0);

        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 30),
          teks: (el.textContent || '').trim().slice(0, 20),
          props: props.filter(p => p !== 'all' && p !== 'none'),
          durMs,
          hasDelay: delay.some(d => parseFloat(d) > 0),
        });
      }
    }
    return JSON.stringify(out);
  })()`, returnByValue: true,
});
const interactive = JSON.parse(r1.result.value);

console.log('=== AUDIT GERAK NYATA (Batch 3) ===\n');
console.log(`Elemen interaktif diperiksa: ${interactive.length}\n`);

// ── 2. Respons hover/press/focus ───────────────────────────────────────────
console.log('── 1. RESPONS STATE (hover / press / focus) ──');
const r2 = await send('Runtime.evaluate', {
  expression: `(() => {
    const hasil = { hover: 0, focus: 0, total: 0, contohTanpa: [] };
    for (const el of document.querySelectorAll('a, button, .btn, .chip, input, select')) {
      // Lewati elemen tersembunyi
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      hasil.total++;

      const cs = getComputedStyle(el);
      const dur = parseFloat(cs.transitionDuration) || 0;
      const props = cs.transitionProperty;

      // Transisi yang menyentuh warna/border/transform = ada respons
      const responsif = dur > 0 && /color|background|border|transform|opacity|box-shadow/.test(props);
      if (responsif) {
        hasil.hover++;
      } else if (hasil.contohTanpa.length < 8) {
        hasil.contohTanpa.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 28),
          teks: (el.textContent || '').trim().slice(0, 18),
          dur: cs.transitionDuration,
          props: String(props).slice(0, 50),
        });
      }

      // Focus state: DUA cara yang sah untuk menampilkan fokus.
      //
      // 1. outline (cara bawaan browser)
      // 2. box-shadow / border (cara yang dipakai proyek ini — lihat
      //    :focus-visible global di premium.css yang set outline: none +
      //    box-shadow: var(--focus-ring))
      //
      // Versi pertama skrip ini HANYA memeriksa outline, sehingga melaporkan
      // 17 elemen "tanpa focus indicator" padahal semuanya tercakup aturan
      // global. Itu false positive yang menyesatkan — dan berbahaya, karena
      // bisa membuat orang "memperbaiki" sesuatu yang sudah benar.
      //
      // Cara benar: periksa apakah ADA aturan :focus-visible yang berlaku
      // untuk elemen ini. Dilakukan dengan mencocokkan selector dari
      // stylesheet, bukan menebak dari computed style.
      const focusVisible = (() => {
        // Punya outline sendiri?
        if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) return true;

        // Punya transisi box-shadow/border (sinyal ada perubahan saat fokus)?
        if (/box-shadow|border/.test(props)) return true;

        // Ada aturan :focus-visible yang cocok dengan elemen ini?
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = sheet.cssRules; } catch { continue; } // CORS
          for (const rule of rules) {
            if (!rule.selectorText?.includes(':focus-visible')) continue;
            const sel = rule.selectorText.replace(/:focus-visible/g, '');
            // Selector global (tanpa prefix) berlaku untuk semua elemen
            if (!sel.trim()) return true;
            try { if (el.matches(sel)) return true; } catch { /* selector aneh */ }
          }
        }
        return false;
      })();
      if (focusVisible) hasil.focus++;
    }
    return JSON.stringify(hasil);
  })()`, returnByValue: true,
});
const state = JSON.parse(r2.result.value);

console.log(`  Elemen interaktif terlihat : ${state.total}`);
console.log(`  Punya transisi responsif   : ${state.hover}/${state.total} ${state.hover === state.total ? '✅' : '⚠'}`);
console.log(`  Punya focus indicator      : ${state.focus}/${state.total} ${state.focus === state.total ? '✅' : '⚠'}`);
if (state.contohTanpa?.length) {
  console.log(`  Contoh tanpa transisi responsif:`);
  for (const c of state.contohTanpa.slice(0, 5)) {
    console.log(`    <${c.tag} class="${c.cls}"> "${c.teks}" dur=${c.dur} props=${c.props.slice(0, 40)}`);
  }
}

// ── 3. Durasi transisi: apakah dalam rentang 120-200ms? ────────────────────
console.log('\n── 2. DURASI (target 120-200ms untuk UI) ──');
const durations = new Map();
for (const el of interactive) {
  for (const d of el.durMs) {
    durations.set(d, (durations.get(d) ?? 0) + 1);
  }
}
const sorted = [...durations].sort((a, b) => b[1] - a[1]);
let dalamRentang = 0, totalDur = 0;
for (const [d, n] of sorted) {
  totalDur += n;
  if (d >= 100 && d <= 250) dalamRentang += n;
}
console.log(`  Distribusi durasi (ms):`);
for (const [d, n] of sorted.slice(0, 10)) {
  const tanda = d >= 100 && d <= 250 ? '✅' : d < 100 ? '⚠ terlalu cepat' : '⚠ terlalu lambat';
  console.log(`    ${String(d).padStart(6)}ms  ${String(n).padStart(3)}x  ${tanda}`);
}
const persen = totalDur ? Math.round(dalamRentang / totalDur * 100) : 0;
console.log(`  Dalam rentang 100-250ms: ${dalamRentang}/${totalDur} = ${persen}% ${persen >= 80 ? '✅' : '⚠'}`);

// ── 4. Animasi tanpa henti ─────────────────────────────────────────────────
console.log('\n── 3. ANIMASI TANPA HENTI (pemicu vestibular) ──');
const r3 = await send('Runtime.evaluate', {
  expression: `(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.animationName === 'none') continue;
      if (cs.animationIterationCount === 'infinite') {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 30),
          name: cs.animationName,
          dur: cs.animationDuration,
        });
      }
    }
    return JSON.stringify(out);
  })()`, returnByValue: true,
});
const loops = JSON.parse(r3.result.value);
if (loops.length === 0) {
  console.log('  ✅ Tidak ada animasi loop tanpa henti');
} else {
  console.log(`  ${loops.length} animasi berjalan terus:`);
  for (const l of loops.slice(0, 8)) {
    console.log(`    <${l.tag} class="${l.cls}"> ${l.name} ${l.dur}`);
  }
  console.log('  → pastikan semuanya berhenti saat prefers-reduced-motion');
}

// ── 5. Animasi properti LAYOUT (mahal, memicu reflow) ──────────────────────
console.log('\n── 4. PROPERTI LAYOUT DI TRANSISI (mahal) ──');
const layoutProps = new Set(['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding', 'font-size']);
const offenders = [];
for (const el of interactive) {
  const bad = el.props.filter(p => layoutProps.has(p));
  if (bad.length && el.durMs.some(d => d > 0)) {
    offenders.push({ el, bad });
  }
}
if (offenders.length === 0) {
  console.log('  ✅ Tidak ada transisi pada properti layout');
} else {
  console.log(`  ${offenders.length} elemen mentransisikan properti layout:`);
  for (const o of offenders.slice(0, 6)) {
    console.log(`    <${o.el.tag}> "${o.el.teks}" → ${o.bad.join(', ')}`);
  }
  console.log('  → properti layout memicu reflow; transform/opacity lebih murah');
}

// ── Ringkasan ──────────────────────────────────────────────────────────────
console.log('\n══════════ RINGKASAN ══════════');
const masalah = [];
if (state.hover < state.total) masalah.push(`${state.total - state.hover} elemen tanpa transisi responsif`);
if (state.focus < state.total) masalah.push(`${state.total - state.focus} elemen tanpa focus indicator`);
if (persen < 80) masalah.push(`hanya ${persen}% durasi dalam rentang ideal`);
if (loops.length > 0) masalah.push(`${loops.length} animasi loop tanpa henti`);
if (offenders.length > 0) masalah.push(`${offenders.length} transisi properti layout`);

if (masalah.length === 0) {
  console.log('✅ Tidak ada masalah gerak yang terukur');
} else {
  console.log('Masalah terukur:');
  for (const m of masalah) console.log(`  • ${m}`);
}
console.log('\nYang TIDAK bisa diukur skrip: apakah geraknya terasa nyaman.');
console.log('Itu butuh mata dan tangan manusia — lihat daftar periksa manual.');

chrome.kill();
