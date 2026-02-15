// KickCraft service worker (GitHub Pages)
// Simple cache-first for app shell + game pages.

const VERSION = 'kickcraft-v3';
const CORE_ASSETS = [
  '/kickcraft/',
  '/kickcraft/index.html',
  '/kickcraft/manifest.webmanifest',
  '/kickcraft/sw.js',
  '/kickcraft/icons/icon-192.png',
  '/kickcraft/icons/icon-512.png',
  '/kickcraft/web/vendor/three.r128.min.js',
  '/kickcraft/web/vendor/react.18.prod.min.js',
  '/kickcraft/web/vendor/react-dom.18.prod.min.js',
  '/kickcraft/web/vendor/babel.min.js',
  '/kickcraft/web/fc-street/index.html',
  '/kickcraft/web/kickcraft-11v11/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle our own origin + scope.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/kickcraft/')) return;

  // Cache-first for GET.
  if (req.method === 'GET') {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
            return res;
          })
          .catch(() => cached);
      })
    );
  }
});
