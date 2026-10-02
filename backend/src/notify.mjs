/**
 * Notifikasi webhook untuk peristiwa penting.
 *
 * Tujuan: pemilik tahu seketika saat ada lead baru atau token dicabut otomatis,
 * tanpa harus membuka dashboard. Mendukung Discord, Slack, dan webhook generik.
 *
 * Prinsip:
 *   - Fire-and-forget: kegagalan webhook TIDAK boleh menggagalkan permintaan user.
 *   - Nol dependency: pakai fetch bawaan Node.
 *   - URL webhook dibaca dari service.env, tidak pernah masuk repo.
 */

import { config } from './config.mjs';

/** Deteksi format webhook dari URL. */
function detectFormat(url) {
  if (/discord(app)?\.com\/api\/webhooks/i.test(url)) return 'discord';
  if (/hooks\.slack\.com/i.test(url)) return 'slack';
  return 'generic';
}

/** Bentuk payload sesuai format webhook. */
function buildPayload(format, { title, lines, severity = 'info' }) {
  const text = [`${title}`, ...lines].join('\n');
  if (format === 'discord') {
    const color = severity === 'alert' ? 0xed4245 : severity === 'lead' ? 0x57f287 : 0x5865f2;
    return {
      embeds: [{
        title,
        description: lines.join('\n'),
        color,
        timestamp: new Date().toISOString(),
        footer: { text: 'Victer Portfolio · Gated Platform' },
      }],
    };
  }
  if (format === 'slack') {
    return { text: `*${title}*\n${lines.join('\n')}` };
  }
  // Generik: JSON yang mudah dipakai Zapier/Make/n8n.
  return { title, text, lines, severity, source: 'portfolio-token-service', at: new Date().toISOString() };
}

/**
 * Kirim notifikasi ke webhook. Tidak melempar error keluar.
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function sendNotification({ title, lines, severity = 'info', url = null }) {
  const target = url ?? config.leadWebhookUrl;
  if (!target) return { sent: false, reason: 'webhook_belum_dikonfigurasi' };

  const format = detectFormat(target);
  const payload = buildPayload(format, { title, lines, severity });

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error?.name === 'TimeoutError' ? 'timeout' : 'network_error' };
  }
}

/** Notifikasi lead baru. Fire-and-forget. */
export function notifyLead(lead) {
  const lines = [
    `**Perusahaan:** ${lead.company || '-'}`,
    `**Nama:** ${lead.name || '-'}`,
    `**Email:** ${lead.email}`,
    `**Peran:** ${lead.role || '-'}`,
    `**Proyek:** ${lead.projectSlug || '-'}`,
    `**Budget:** ${lead.budgetRange || '-'}`,
    `**Urgensi:** ${lead.urgency || '-'}`,
  ];
  if (lead.message) lines.push(`**Pesan:** ${String(lead.message).slice(0, 500)}`);

  sendNotification({ title: '🔔 Lead baru masuk', lines, severity: 'lead' })
    .then((r) => {
      if (!r.sent && r.reason !== 'webhook_belum_dikonfigurasi') {
        console.error(`[notify] lead gagal terkirim: ${r.reason}`);
      }
    });
}

/** Notifikasi token dicabut otomatis (sharing/scrape terdeteksi). */
export function notifyAutoRevoke({ tokenLabel, reason, ipCount, detail = '' }) {
  const lines = [
    `**Token:** ${tokenLabel || '(tanpa label)'}`,
    `**Alasan:** ${reason}`,
    ipCount != null ? `**IP berbeda:** ${ipCount}` : null,
    detail ? `**Detail:** ${detail}` : null,
    '',
    'Token ini sudah tidak bisa dipakai. Terbitkan token baru lewat admin CLI bila perlu.',
  ].filter(Boolean);

  sendNotification({ title: '🚨 Token dicabut otomatis', lines, severity: 'alert' })
    .then((r) => {
      if (!r.sent && r.reason !== 'webhook_belum_dikonfigurasi') {
        console.error(`[notify] alert revoke gagal terkirim: ${r.reason}`);
      }
    });
}
