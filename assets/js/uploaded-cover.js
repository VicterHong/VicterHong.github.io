// Sampul proyek folder. Tidak pernah membuat visual, angka, atau layar tiruan;
// hanya menampilkan berkas yang benar-benar diunggah pemilik.
const COVER = /^assets\/projects\/[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?\/cover\.(?:jpe?g|png|webp)$/;

export function createProjectCover(project, doc = document) {
  if (!COVER.test(project?.cover ?? '')) return null;
  const image = doc.createElement('img');
  image.className = 'project-uploaded-cover';
  image.src = project.cover;
  image.alt = String(project.coverAlt || `Sampul ${project.name || 'proyek'}`).slice(0, 160);
  image.loading = 'lazy';
  image.decoding = 'async';
  image.width = 620;
  image.height = 820;
  return image;
}
