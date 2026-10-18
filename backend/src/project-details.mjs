/** Presentation evidence lives beside locked content, never in public assets. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';

export function projectDetails(slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return null;
  try {
    const catalogue = JSON.parse(readFileSync(join(config.contentDir, 'presentation.json'), 'utf8'));
    const data = Object.hasOwn(catalogue, slug) ? catalogue[slug] : null;
    if (!data || !Array.isArray(data.metrics) || !Array.isArray(data.highlights)) return null;
    return { metrics: data.metrics, highlights: data.highlights };
  } catch { return null; }
}
