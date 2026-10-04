// Cek cepat: apakah /api/config mengembalikan daftar proyek?
const res = await fetch('http://127.0.0.1:8788/api/config');
const data = await res.json();
console.log('status:', res.status);
console.log('turnstile enabled:', data.turnstile?.enabled);
console.log('projects:', JSON.stringify(data.projects, null, 2));
console.log('');
console.log(data.projects?.length >= 2
  ? `✅ /api/config mengembalikan ${data.projects.length} proyek`
  : '❌ proyek tidak ada di respons /api/config');
