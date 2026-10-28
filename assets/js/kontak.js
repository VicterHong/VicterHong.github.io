const EMAIL = 'vivastic.id@gmail.com';

export function susunEmailBrief({ nama = '', kebutuhan = '', tujuan = 'kerja-sama' } = {}) {
  const topik = String(tujuan).replace(/[\r\n]/g, ' ').slice(0, 80);
  const params = new URLSearchParams({
    subject: `VIVASTIC: ${topik}`,
    body: `Nama/tim: ${String(nama).trim().slice(0, 120)}\nTopik: ${topik}\n\n${String(kebutuhan).trim().slice(0, 2000)}`,
  });
  return `mailto:${EMAIL}?${params.toString().replaceAll('+', '%20')}`;
}

if (typeof document !== 'undefined') {
  const form = document.getElementById('briefForm');
  const draft = document.getElementById('briefDraft');
  const status = document.getElementById('briefStatus');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    draft.href = susunEmailBrief(data);
    draft.hidden = false;
    status.textContent = 'Draft siap, pesan belum terkirim. Buka aplikasi email lalu kirim, atau tulis langsung ke vivastic.id@gmail.com.';
    draft.focus();
  });
  form?.addEventListener('input', () => {
    draft.hidden = true;
    draft.href = `mailto:${EMAIL}`;
    status.textContent = '';
  });
}
