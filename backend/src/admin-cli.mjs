#!/usr/bin/env node
/**
 * CLI admin untuk mengelola token akses.
 *
 * Dipakai pemilik portofolio untuk menerbitkan dan mencabut token tanpa
 * membuka HTTP endpoint admin.
 *
 * Contoh:
 *   node src/admin-cli.mjs issue --project mina --to "PT Contoh" --days 30
 *   node src/admin-cli.mjs list
 *   node src/admin-cli.mjs revoke --id tok_abc123 --reason "kontrak selesai"
 *   node src/admin-cli.mjs audit --project mina --limit 20
 *   node src/admin-cli.mjs leads
 */

import { config, validateConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { getToken, issueToken, listTokens, revokeToken } from './tokens.mjs';
import { listLeads, recentEvents } from './audit.mjs';
import { getFunnel, uniqueVisitors } from './analytics.mjs';

/** Urai argumen sederhana: --key value atau --flag. */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const fmt = (ms) => (ms ? new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 19) : '—');

function usage() {
  console.log(`Layanan token portofolio — CLI admin

Perintah:
  issue     --project <slug> [--tier standard|enterprise] [--scopes <slug1,slug2>]
            [--to <nama>] [--company <nama>] [--label <teks>] [--days <n>]
            [--max-ips <n>] [--max-devices <n>] [--notes <teks>]
  list      [--project <slug>] [--status active|revoked|suspended] [--tier <tier>] [--limit <n>]
  show      --id <token_id>
  revoke    --id <token_id> [--reason <teks>]
  audit     [--project <slug>] [--token <token_id>] [--limit <n>]
  leads     [--status new|contacted] [--limit <n>]
  funnel    [--project <slug>] [--days <n>]
  visitors  [--project <slug>] [--days <n>]

Contoh:
  node src/admin-cli.mjs issue --project mina --to "PT Contoh" --days 30
  node src/admin-cli.mjs issue --project mina --tier enterprise --scopes mina,spareparts --company "PT Besar" --days 90
  node src/admin-cli.mjs list --project mina
  node src/admin-cli.mjs revoke --id tok_1a2b3c4d --reason "kontrak selesai"
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || args.help) {
    usage();
    return 0;
  }

  const problems = validateConfig();
  if (problems.length) {
    console.error('Konfigurasi belum lengkap:');
    for (const p of problems) console.error('  -', p);
    return 1;
  }

  openDb(config.dbPath);

  switch (cmd) {
    case 'issue': {
      const project = String(args.project ?? '').trim();
      if (!project) { console.error('--project wajib diisi'); return 1; }

      // Parse scopes
      let scopes = null;
      if (args.scopes) {
        scopes = String(args.scopes).split(',').map(s => s.trim()).filter(Boolean);
      }

      const result = issueToken({
        secret: config.secret,
        projectSlug: project,
        tier: String(args.tier ?? 'standard').toLowerCase(),
        scopes,
        label: String(args.label ?? ''),
        issuedTo: String(args.to ?? ''),
        company: String(args.company ?? ''),
        issuedBy: 'cli',
        expiresInDays: args.days ? Number(args.days) : null,
        maxIps: args['max-ips'] ? Number(args['max-ips']) : config.maxDistinctIps,
        maxDevices: args['max-devices'] ? Number(args['max-devices']) : config.maxDevices,
        notes: String(args.notes ?? ''),
        prefix: config.tokenPrefix,
        segments: config.tokenSegments,
        segmentLength: config.tokenSegmentLength,
      });
      console.log('');
      console.log('  Token diterbitkan.');
      console.log('');
      console.log('  ID           :', result.id);
      console.log('  Proyek       :', result.project_slug);
      console.log('  Tier         :', result.tier);
      console.log('  Scope        :', result.scopes.join(', '));
      console.log('  Berlaku      :', result.expires_at ? `sampai ${fmt(result.expires_at)}` : 'tanpa kedaluwarsa');
      console.log('  Maks IP      :', result.max_ips);
      console.log('  Maks Device  :', result.max_devices);
      console.log('');
      console.log('  TOKEN (tampil sekali — simpan sekarang):');
      console.log('');
      console.log('   ', result.token);
      console.log('');
      return 0;
    }

    case 'list': {
      const rows = listTokens({
        projectSlug: args.project ?? null,
        status: args.status ?? null,
        tier: args.tier ?? null,
        limit: args.limit ? Number(args.limit) : 100,
      });
      if (!rows.length) { console.log('(belum ada token)'); return 0; }
      console.log('');
      console.log('  ID                PROYEK        TIER        STATUS      DIBERIKAN KE            KEDALUWARSA');
      console.log('  ' + '─'.repeat(100));
      for (const r of rows) {
        console.log(
          '  ' + String(r.id).padEnd(17) +
          String(r.project_slug).padEnd(14) +
          String(r.tier).padEnd(12) +
          String(r.status).padEnd(12) +
          String(r.issued_to || '—').slice(0, 22).padEnd(24) +
          fmt(r.expires_at)
        );
      }
      console.log('');
      console.log('  Total:', rows.length);
      console.log('');
      return 0;
    }

    case 'show': {
      const row = getToken(String(args.id ?? ''));
      if (!row) { console.error('token tidak ditemukan'); return 1; }
      const { token_hash: _h, ...safe } = row;
      console.log(JSON.stringify(safe, null, 2));
      return 0;
    }

    case 'revoke': {
      const id = String(args.id ?? '');
      if (!id) { console.error('--id wajib diisi'); return 1; }
      const result = revokeToken(id, String(args.reason ?? 'manual'), { automatic: false });
      console.log(result.revoked ? '  Token dicabut.' : '  Token sudah dicabut sebelumnya (atau tidak ada).');
      return 0;
    }

    case 'audit': {
      const events = recentEvents({
        limit: args.limit ? Number(args.limit) : 50,
        tokenId: args.token ?? null,
        projectSlug: args.project ?? null,
      });
      if (!events.length) { console.log('(belum ada peristiwa)'); return 0; }
      console.log('');
      console.log('  WAKTU                PROYEK        AKSI           HASIL              IP');
      console.log('  ' + '─'.repeat(94));
      for (const e of events) {
        console.log(
          '  ' + fmt(e.at).padEnd(21) +
          String(e.project_slug || '—').padEnd(14) +
          String(e.action).padEnd(15) +
          String(e.outcome).padEnd(19) +
          String(e.ip || '—')
        );
      }
      console.log('');
      return 0;
    }

    case 'leads': {
      const leads = listLeads({ limit: args.limit ? Number(args.limit) : 50, status: args.status ?? null });
      if (!leads.length) { console.log('(belum ada permintaan)'); return 0; }
      console.log('');
      for (const l of leads) {
        console.log('  ──', fmt(l.created_at), '·', l.status);
        console.log('     Perusahaan  :', l.company || '—');
        console.log('     Nama        :', l.name || '—');
        console.log('     Email       :', l.email);
        console.log('     Role        :', l.role || '—');
        console.log('     Proyek      :', l.project_slug || '—');
        console.log('     Budget      :', l.budget_range || '—');
        console.log('     Urgensi     :', l.urgency || '—');
        if (l.message) console.log('     Pesan       :', l.message.slice(0, 200));
        console.log('');
      }
      console.log('  Total:', leads.length);
      console.log('');
      return 0;
    }

    case 'funnel': {
      const days = args.days ? Number(args.days) : 30;
      const windowMs = days * 24 * 60 * 60 * 1000;
      const funnel = getFunnel({ projectSlug: args.project ?? null, windowMs });
      const visitors = uniqueVisitors({ projectSlug: args.project ?? null, windowMs });

      console.log('');
      console.log('  FUNNEL ANALYTICS');
      console.log('  Proyek :', args.project ?? 'semua');
      console.log('  Periode:', days, 'hari');
      console.log('  Visitor:', visitors, 'unik');
      console.log('');
      console.log('  Step                Count');
      console.log('  ' + '─'.repeat(30));
      for (const [step, count] of Object.entries(funnel)) {
        if (step === 'conversion_rate') continue;
        console.log('  ' + String(step).padEnd(20) + String(count).padStart(6));
      }
      console.log('');
      console.log('  Conversion Rates');
      console.log('  ' + '─'.repeat(30));
      for (const [rate, value] of Object.entries(funnel.conversion_rate)) {
        console.log('  ' + String(rate).padEnd(20) + String(value).padStart(6) + '%');
      }
      console.log('');
      return 0;
    }

    case 'visitors': {
      const days = args.days ? Number(args.days) : 30;
      const windowMs = days * 24 * 60 * 60 * 1000;
      const visitors = uniqueVisitors({ projectSlug: args.project ?? null, windowMs });
      console.log('');
      console.log('  Unique visitors:', visitors);
      console.log('  Proyek         :', args.project ?? 'semua');
      console.log('  Periode        :', days, 'hari');
      console.log('');
      return 0;
    }

    default:
      console.error(`Perintah tidak dikenal: ${cmd}`);
      usage();
      return 1;
  }
}

process.exit(main());
