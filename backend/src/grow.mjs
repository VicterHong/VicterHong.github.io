/**
 * Grow — eksperimen A/B dan pengukuran konversi.
 *
 * Meniru "Grow"/"Convert" Framer: uji dua varian, ukur mana yang lebih baik,
 * putuskan dengan DATA — bukan selera. Statistik dihitung sederhana tapi benar:
 *   - Konversi per varian (rate)
 *   - Selisih relatif (lift)
 *   - Signifikansi lewat uji-z dua proporsi (alpha 0.05)
 *
 * Untuk trafik kecil, kami tampilkan peringatan jujur: "belum cukup sampel".
 */

import { getDb } from './db.mjs';
import { isValidSlug } from './cms.mjs';

const STATUSES = new Set(['draft', 'running', 'paused', 'done']);

export function createExperiment({ slug, name, variants, goal = 'conversion' }) {
  if (!isValidSlug(slug)) throw new Error('slug eksperimen tidak valid');
  const list = Array.isArray(variants) && variants.length >= 2
    ? variants.map(v => String(v).slice(0, 60))
    : ['control', 'variant'];

  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO experiments (slug, name, status, variants, goal, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET name = excluded.name, variants = excluded.variants,
       goal = excluded.goal, updated_at = excluded.updated_at`
  ).run(slug, String(name ?? slug).slice(0, 200), JSON.stringify(list), String(goal).slice(0, 60), now, now);
  return getExperiment(slug);
}

export function getExperiment(slug) {
  if (!isValidSlug(slug)) return null;
  const row = getDb().prepare('SELECT * FROM experiments WHERE slug = ?').get(slug);
  if (!row) return null;
  return { ...row, variants: safeParse(row.variants, []) };
}

export function listExperiments() {
  return getDb().prepare('SELECT * FROM experiments ORDER BY updated_at DESC').all()
    .map(r => ({ ...r, variants: safeParse(r.variants, []) }));
}

export function setStatus(slug, status) {
  if (!STATUSES.has(status)) throw new Error('status tidak valid');
  getDb().prepare('UPDATE experiments SET status = ?, updated_at = ? WHERE slug = ?')
    .run(status, Date.now(), slug);
  return getExperiment(slug);
}

/**
 * Pilih varian untuk pengunjung.
 * Deterministik per visitor (hash sederhana) supaya pengunjung yang sama
 * selalu melihat varian yang sama — syarat sahnya sebuah eksperimen.
 */
export function pickVariant(slug, visitor) {
  const exp = getExperiment(slug);
  if (!exp || exp.status !== 'running' || !exp.variants.length) return null;
  let h = 2166136261;
  const key = `${slug}:${visitor || 'anon'}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return exp.variants[Math.abs(h) % exp.variants.length];
}

export function recordEvent({ slug, variant, event = 'exposure', visitor = '', country = '' }) {
  if (!isValidSlug(slug)) return false;
  getDb().prepare(
    `INSERT INTO experiment_events (slug, variant, event, visitor, country, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(slug, String(variant ?? '').slice(0, 60), String(event).slice(0, 60), String(visitor).slice(0, 120), String(country).slice(0, 8), Date.now());
  return true;
}

/**
 * Hasil eksperimen + uji signifikansi.
 * event konversi default 'conversion'; exposure dihitung dari event 'exposure'.
 */
export function results(slug, { conversionEvent = 'conversion' } = {}) {
  const exp = getExperiment(slug);
  if (!exp) return null;
  const db = getDb();

  const rows = db.prepare(
    `SELECT variant, event, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS total
     FROM experiment_events WHERE slug = ?
     GROUP BY variant, event`
  ).all(slug);

  const byVariant = {};
  for (const v of exp.variants) byVariant[v] = { variant: v, exposed: 0, converted: 0 };

  for (const r of rows) {
    if (!byVariant[r.variant]) byVariant[r.variant] = { variant: r.variant, exposed: 0, converted: 0 };
    if (r.event === 'exposure') byVariant[r.variant].exposed = r.visitors;
    if (r.event === conversionEvent) byVariant[r.variant].converted = r.visitors;
  }

  const variants = Object.values(byVariant).map(v => ({
    ...v,
    rate: v.exposed > 0 ? v.converted / v.exposed : 0,
  }));

  const withRate = variants.filter(v => v.exposed > 0);
  const control = withRate.find(v => v.variant === 'control') ?? withRate[0] ?? null;

  let verdict = { state: 'no_data', message: 'Belum ada data.' };
  if (control && withRate.length >= 2) {
    const challengers = withRate.filter(v => v !== control);
    const best = challengers.sort((a, b) => b.rate - a.rate)[0];
    const test = twoProportionZ(control, best);

    const totalExposed = withRate.reduce((s, v) => s + v.exposed, 0);
    if (totalExposed < 100) {
      verdict = {
        state: 'insufficient',
        message: `Baru ${totalExposed} pengunjung. Butuh minimal ~100 per varian untuk kesimpulan yang bisa dipercaya.`,
      };
    } else if (test.p < 0.05) {
      verdict = {
        state: 'winner',
        winner: best.variant,
        lift: control.rate > 0 ? (best.rate - control.rate) / control.rate : null,
        p_value: round(test.p, 4),
        message: `"${best.variant}" menang secara statistik (p=${round(test.p, 4)}).`,
      };
    } else {
      verdict = {
        state: 'inconclusive',
        p_value: round(test.p, 4),
        message: `Belum ada perbedaan signifikan (p=${round(test.p, 4)}). Lanjutkan pengumpulan data.`,
      };
    }
  }

  return {
    slug, name: exp.name, status: exp.status, goal: exp.goal,
    variants, control: control?.variant ?? null, verdict,
  };
}

/**
 * Uji-z dua proporsi (two-proportion z-test), two-tailed.
 * Dipakai untuk menjawab: "apakah beda ini kebetulan atau nyata?"
 */
export function twoProportionZ(a, b) {
  const n1 = a.exposed, x1 = a.converted;
  const n2 = b.exposed, x2 = b.converted;
  if (!n1 || !n2) return { z: 0, p: 1 };

  const p1 = x1 / n1, p2 = x2 / n2;
  const pPool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, p: 1 };

  const z = (p1 - p2) / se;
  // Two-tailed p-value dari distribusi normal standar.
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { z: round(z, 4), p };
}

/** Aproksimasi CDF normal (Abramowitz & Stegun 7.1.26) — akurat sampai 1e-7. */
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
}

function round(v, dp = 4) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
