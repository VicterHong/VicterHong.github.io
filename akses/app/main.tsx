import { createRoot } from 'react-dom/client';
import App from './App';

// CSS TIDAK diimpor di sini: halaman memuatnya lewat <link> sendiri. Kalau
// diimpor dari sini, bundler ikut memproses rujukan font dan gagal karena
// font disalin terpisah.

/**
 * Entry bundle. Halaman hanya mengimpor berkas ini; memasang dirinya sendiri
 * ke #root, jadi tidak ada fungsi ekspor yang harus dipanggil pemanggil.
 */
const host = document.getElementById('root');
if (host) {
  host.replaceChildren();
  createRoot(host).render(<App />);
}
