/**
 * Logo teknologi — SVG inline, nol dependency eksternal.
 *
 * Setiap logo dibuat sederhana tapi tetap dikenali: bentuk khas + warna merek.
 * Ukuran viewBox seragam (24x24) supaya grid tetap rapi.
 *
 * Kenapa SVG inline, bukan <img> dari CDN?
 *   - Tidak ada request eksternal → halaman tetap cepat dan privat
 *   - Warna bisa diubah via CSS (currentColor / var)
 *   - Tidak akan hilang kalau CDN mati
 */

const NS = 'http://www.w3.org/2000/svg';

/** Bungkus path jadi elemen SVG siap pakai. */
function svg(viewBox, children, { fill = 'currentColor' } = {}) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  if (fill) el.setAttribute('fill', fill);
  for (const child of children) el.append(child);
  return el;
}

function path(d, attrs = {}) {
  const el = document.createElementNS(NS, 'path');
  el.setAttribute('d', d);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function circle(cx, cy, r, attrs = {}) {
  const el = document.createElementNS(NS, 'circle');
  el.setAttribute('cx', cx);
  el.setAttribute('cy', cy);
  el.setAttribute('r', r);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function rect(x, y, w, h, attrs = {}) {
  const el = document.createElementNS(NS, 'rect');
  el.setAttribute('x', x);
  el.setAttribute('y', y);
  el.setAttribute('width', w);
  el.setAttribute('height', h);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Katalog logo. Setiap entri: nama tampil + warna merek + fungsi pembuat SVG.
 * Warna merek dipakai untuk efek hover (glow + warna logo).
 */
export const techLogos = {
  python: {
    label: 'Python',
    color: '#3776AB',
    // Dua ular saling melingkar — bentuk resmi Python (biru atas, kuning bawah)
    render: () => svg('0 0 24 24', [
      path('M11.9 2c-2.4 0-4.3.9-4.3 2.8V7h4.5v.7H5.8C3.6 7.7 2 9.2 2 11.6s1.5 3.9 3.7 3.9h1.4v-2.3c0-2 1.7-3.5 3.8-3.5h4.5c1.7 0 3-1.4 3-3V4.8C18.4 2.9 16.3 2 11.9 2zm-2.3 1.5a.9.9 0 110 1.8.9.9 0 010-1.8z', { fill: '#3776AB' }),
      path('M12.1 22c2.4 0 4.3-.9 4.3-2.8V17h-4.5v-.7h6.3c2.2 0 3.8-1.5 3.8-3.9s-1.5-3.9-3.7-3.9h-1.4v2.3c0 2-1.7 3.5-3.8 3.5H8.6c-1.7 0-3 1.4-3 3v1.9C5.6 21.1 7.7 22 12.1 22zm2.3-1.5a.9.9 0 110-1.8.9.9 0 010 1.8z', { fill: '#FFD43B' }),
    ]),
  },
  javascript: {
    label: 'JavaScript',
    color: '#F7DF1E',
    // Kotak kuning dengan "JS" — bentuk resmi JavaScript
    render: () => svg('0 0 24 24', [
      rect(2, 2, 20, 20, { rx: 2, fill: '#F7DF1E' }),
      path('M11.6 18.6V16h1.5v2.5c0 .6.2.9.7.9.4 0 .7-.3.7-.9V16h1.5v2.6c0 1.5-.8 2.3-2.2 2.3-1.5 0-2.2-.8-2.2-2.3zM6.6 18.4l1.1-.7c.2.4.5.7 1 .7.4 0 .7-.2.7-.6 0-.4-.3-.5-.8-.8l-.4-.2c-.9-.4-1.4-.9-1.4-1.8 0-1 .8-1.7 1.9-1.7.8 0 1.4.3 1.8 1l-1 .7c-.2-.3-.4-.5-.8-.5-.3 0-.6.2-.6.5 0 .3.2.5.7.7l.4.2c1 .4 1.5.9 1.5 1.9 0 1.1-.8 1.8-2.1 1.8-1.2 0-1.9-.6-2.3-1.4z', { fill: '#000' }),
    ]),
  },
  typescript: {
    label: 'TypeScript',
    color: '#3178C6',
    // Kotak biru dengan "TS" — bentuk resmi TypeScript
    render: () => svg('0 0 24 24', [
      rect(2, 2, 20, 20, { rx: 2, fill: '#3178C6' }),
      path('M6 11.5h6v1.6H9.8V20H8V13.1H6v-1.6zm7 7.1c.6.4 1.4.7 2.2.7 1.8 0 2.9-.9 2.9-2.4 0-1.3-.7-1.9-2-2.4l-.6-.3c-.7-.3-1-.5-1-.8 0-.3.2-.5.7-.5s.8.2 1.1.5l1-1.2c-.6-.5-1.4-.8-2.3-.8-1.5 0-2.6.9-2.6 2.1 0 1.3.8 1.9 1.9 2.3l.6.3c.8.3 1.1.6 1.1 1 0 .4-.3.7-.9.7-.7 0-1.3-.3-1.8-.7l-1 1.5z', { fill: '#fff' }),
    ]),
  },
  sql: {
    label: 'SQL',
    color: '#4479A1',
    render: () => svg('0 0 24 24', [
      path('M12 2C7 2 3 3.6 3 5.5v13C3 20.4 7 22 12 22s9-1.6 9-3.5v-13C21 3.6 17 2 12 2zm0 2c4.4 0 7 1.3 7 1.5S16.4 7 12 7 5 5.7 5 5.5 7.6 4 12 4zm7 14.5c0 .2-2.6 1.5-7 1.5s-7-1.3-7-1.5v-3.2c1.5.9 4.2 1.4 7 1.4s5.5-.5 7-1.4v3.2zm0-6c0 .2-2.6 1.5-7 1.5s-7-1.3-7-1.5v-3.2c1.5.9 4.2 1.4 7 1.4s5.5-.5 7-1.4v3.2z', { fill: '#4479A1' }),
    ]),
  },
  fastapi: {
    label: 'FastAPI',
    color: '#009688',
    render: () => svg('0 0 24 24', [
      circle(12, 12, 10, { fill: 'none', stroke: '#009688', 'stroke-width': 1.5 }),
      path('M12 4.5l-5 10h4l-1.5 5 6-10.5h-4l.5-4.5z', { fill: '#009688' }),
    ]),
  },
  node: {
    label: 'Node.js',
    color: '#5FA04E',
    render: () => svg('0 0 24 24', [
      path('M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.3l6.8 3.8v7.8L12 19.7l-6.8-3.8V8.1L12 4.3z', { fill: '#5FA04E' }),
      path('M13.8 9v4.2c0 .9-.7 1.3-1.8 1.3-1 0-1.6-.4-1.6-1.1v-.4h1.2v.2c0 .2.2.3.5.3s.5-.1.5-.4V9h1.2z', { fill: '#5FA04E' }),
      circle(16.5, 13, 1.2, { fill: '#5FA04E' }),
    ]),
  },
  postgresql: {
    label: 'PostgreSQL',
    color: '#4169E1',
    // Gajah dengan kepala menghadap kanan — bentuk resmi PostgreSQL
    render: () => svg('0 0 24 24', [
      // Kepala + belalai
      path('M12 2C7.5 2 5 4.2 5 8.2c0 2.2.4 4 1.3 5.4.4.6.8.9 1.2.9.5 0 .8-.5.7-1.2l-.2-1.2c.7 1 1.8 1.8 3 2.1.3 1.2 1 1.9 2 1.9s1.7-.7 2-1.9c1.2-.3 2.3-1.1 3-2.1l-.2 1.2c-.1.7.2 1.2.7 1.2.4 0 .8-.3 1.2-.9.9-1.4 1.3-3.2 1.3-5.4C19 4.2 16.5 2 12 2z', { fill: '#4169E1' }),
      // Mata
      circle(9.5, 7.5, 1.1, { fill: '#fff' }),
      circle(14.5, 7.5, 1.1, { fill: '#fff' }),
      circle(9.7, 7.7, 0.55, { fill: '#000' }),
      circle(14.7, 7.7, 0.55, { fill: '#000' }),
      // Hidung/belalai
      path('M11 12c-.4.8-.5 1.7-.3 2.4.2.6.7 1 1.3 1s1.1-.4 1.3-1c.2-.7.1-1.6-.3-2.4-.3-.5-.7-.8-1-.8s-.7.3-1 .8z', { fill: '#fff' }),
      // Telinga
      path('M6 8c-.8-.3-1.4 0-1.5.7-.1.7.4 1.3 1.2 1.5z', { fill: '#4169E1' }),
      path('M18 8c.8-.3 1.4 0 1.5.7.1.7-.4 1.3-1.2 1.5z', { fill: '#4169E1' }),
    ]),
  },
  sqlite: {
    label: 'SQLite',
    color: '#003B57',
    render: () => svg('0 0 24 24', [
      path('M12 2C7.6 2 5 3.4 5 5v14c0 1.6 2.6 3 7 3s7-1.4 7-3V5c0-1.6-2.6-3-7-3zm5 17c0 .3-1.9 1.5-5 1.5S7 19.3 7 19v-2.8c1.3.7 3.2 1.1 5 1.1s3.7-.4 5-1.1V19zm0-4c0 .3-1.9 1.5-5 1.5S7 15.3 7 15v-2.8c1.3.7 3.2 1.1 5 1.1s3.7-.4 5-1.1V15zm0-4c0 .3-1.9 1.5-5 1.5S7 11.3 7 11V8.2C8.3 8.9 10.2 9.3 12 9.3s3.7-.4 5-1.1V11z', { fill: '#003B57' }),
    ]),
  },
  docker: {
    label: 'Docker',
    color: '#2496ED',
    // Paus dengan kontainer di punggung — bentuk resmi Docker
    render: () => svg('0 0 24 24', [
      // Kontainer (kotak-kotak di atas paus)
      rect(4, 8, 3, 3, { fill: '#2496ED' }),
      rect(7.5, 8, 3, 3, { fill: '#2496ED' }),
      rect(11, 8, 3, 3, { fill: '#2496ED' }),
      rect(7.5, 4.5, 3, 3, { fill: '#2496ED' }),
      rect(11, 4.5, 3, 3, { fill: '#2496ED' }),
      rect(11, 11.5, 3, 3, { fill: '#2496ED' }),
      // Paus (badan) + sirip
      path('M2 13.5h20c0 3.5-2.5 6-6.5 6h-6C5.5 19.5 3 17 2 13.5z', { fill: '#2496ED' }),
      path('M22 13.5c.5-1 .3-2-.5-2.3-.4-.1-.8 0-1 .3.3.6.8 1.4 1.5 2z', { fill: '#2496ED' }),
    ]),
  },
  systemd: {
    label: 'systemd',
    color: '#30D475',
    render: () => svg('0 0 24 24', [
      path('M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 2.3L6 8.7v6.6l6 3.4 6-3.4V8.7l-6-3.4z', { fill: '#30D475' }),
      path('M12 8l3.5 4-3.5 4-3.5-4L12 8z', { fill: '#30D475' }),
    ]),
  },
  linux: {
    label: 'Linux',
    color: '#FCC624',
    render: () => svg('0 0 24 24', [
      path('M12 2c-2 0-3 1.5-3 3.5 0 1 .1 2-.3 3-1 2.5-3.2 5-3.2 8 0 3 2.5 5.5 6.5 5.5s6.5-2.5 6.5-5.5c0-3-2.2-5.5-3.2-8-.4-1-.3-2-.3-3C15 3.5 14 2 12 2zm-1.5 3.5a1 1 0 110 2 1 1 0 010-2zm3 0a1 1 0 110 2 1 1 0 010-2zM12 9l2 3h-4l2-3z', { fill: '#FCC624' }),
      path('M10 15.5c.5.5 1.2.8 2 .8s1.5-.3 2-.8c-.5.2-1.2.4-2 .4s-1.5-.2-2-.4z', { fill: '#333' }),
    ]),
  },
  cloudflare: {
    label: 'Cloudflare',
    color: '#F38020',
    render: () => svg('0 0 24 24', [
      path('M17.5 12c-.3 0-.6 0-.8.1-.2-2.3-2.1-4.1-4.5-4.1-1.9 0-3.5 1.1-4.2 2.8-.2 0-.4-.1-.6-.1C5 10.7 3.3 12.4 3.3 14.5c0 .1 0 .3.1.4h14.1c.1-.1.1-.2.1-.3.1-1.5-1-2.6-2.1-2.6z', { fill: '#F38020' }),
      path('M20.5 12.5c-.2 0-.3 0-.5.1-.2-.9-.9-1.5-1.8-1.5-.7 0-1.4.4-1.7 1 1.5.2 2.7 1.4 2.9 2.9h1.6c.1-.1.1-.2.1-.3 0-1.2-.9-2.2-2.1-2.2z', { fill: '#FAAE40' }),
    ]),
  },
  telegram: {
    label: 'Telegram',
    color: '#26A5E4',
    render: () => svg('0 0 24 24', [
      circle(12, 12, 10, { fill: '#26A5E4' }),
      path('M17 8l-1.6 7.5c-.1.5-.4.6-.9.4l-2.5-1.8-1.2 1.2c-.1.1-.3.3-.5.3l.2-2.6 4.7-4.2c.2-.2 0-.3-.3-.1l-5.8 3.6-2.5-.8c-.5-.2-.5-.5.1-.8l9.7-3.7c.4-.2.8.1.6.8z', { fill: '#fff' }),
    ]),
  },
  discord: {
    label: 'Discord',
    color: '#5865F2',
    render: () => svg('0 0 24 24', [
      path('M19.3 5.3A17 17 0 0015 4l-.2.4a13 13 0 013.8 1.9 12 12 0 00-10.2 0A13 13 0 0112.2 4L12 4a17 17 0 00-4.3 1.3C5 9.5 4.3 13.6 4.7 17.7A17 17 0 009 20l.7-1.1a11 11 0 01-1.8-.9l.4-.3a12 12 0 0010.4 0l.4.3a11 11 0 01-1.8.9L17 20a17 17 0 004.3-2.3c.4-4.1-.3-8.2-2-12.4zM9.7 15.3c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7zm4.6 0c-.8 0-1.5-.8-1.5-1.7s.7-1.7 1.5-1.7 1.5.8 1.5 1.7-.7 1.7-1.5 1.7z', { fill: '#5865F2' }),
    ]),
  },
  whatsapp: {
    label: 'WhatsApp',
    color: '#25D366',
    render: () => svg('0 0 24 24', [
      path('M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 2a8 8 0 110 16 8 8 0 01-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 0112 4zm-2.8 4c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.8 2.2.9 2.6.7 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2l-.4-.2-1.5-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.2-.1-1-.4-1.9-1.2-.7-.6-1.2-1.4-1.3-1.6-.1-.2 0-.3.1-.4l.3-.4c.1-.1.2-.2.2-.4v-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.2z', { fill: '#25D366' }),
    ]),
  },
  n8n: {
    label: 'n8n',
    color: '#EA4B71',
    render: () => svg('0 0 24 24', [
      circle(6, 12, 3, { fill: 'none', stroke: '#EA4B71', 'stroke-width': 1.8 }),
      circle(18, 6, 3, { fill: 'none', stroke: '#EA4B71', 'stroke-width': 1.8 }),
      circle(18, 18, 3, { fill: 'none', stroke: '#EA4B71', 'stroke-width': 1.8 }),
      path('M9 12h3m0 0l3-4.5M12 12l3 4.5', { stroke: '#EA4B71', 'stroke-width': 1.8, fill: 'none', 'stroke-linecap': 'round' }),
    ]),
  },
};

/** Kelompok untuk tampilan. */
export const techGroups = [
  { group: 'Bahasa', keys: ['python', 'javascript', 'typescript', 'sql'] },
  { group: 'Backend', keys: ['fastapi', 'node', 'postgresql', 'sqlite'] },
  { group: 'Infrastruktur', keys: ['docker', 'systemd', 'linux', 'cloudflare'] },
  { group: 'Integrasi', keys: ['telegram', 'discord', 'whatsapp', 'n8n'] },
];

/**
 * Buat kartu logo satu teknologi.
 * @param {string} key kunci di techLogos
 * @returns {HTMLElement}
 */
export function createTechCard(key) {
  const entry = techLogos[key];
  const card = document.createElement('div');
  card.className = 'tech-card';
  card.style.setProperty('--tech-color', entry.color);
  card.setAttribute('title', entry.label);

  const iconWrap = document.createElement('div');
  iconWrap.className = 'tech-icon';
  iconWrap.append(entry.render());

  const name = document.createElement('span');
  name.className = 'tech-name';
  name.textContent = entry.label;

  card.append(iconWrap, name);
  return card;
}
