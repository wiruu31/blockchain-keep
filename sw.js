/* Blockchain Keep v1.0.0 — sw.js
 * Service worker: menyimpan file aplikasi agar bisa dibuka offline.
 * Hanya menangani permintaan GET ke situs ini; Google Drive/Login tidak pernah dicegat atau di-cache.
 * Saat mengubah file aplikasi, naikkan VERSION agar cache lama diganti.
 */
const VERSION = '1.0.0';
const CACHE = 'bkeep-' + VERSION;
const FILES = [
  './', 'index.html', 'keep.css', 'sandi.js', 'data.js', 'drive.js', 'ui.js', 'app.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'maskable-512.png', 'apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bkeep-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
