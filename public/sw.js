/* TubeDL Service Worker */
const CACHE = 'tubedl-v1';
const SHELL = ['/', '/css/style.css', '/js/app.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Always network-first for API and WebSocket
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
    return;
  }

  // Cache-first for static assets
  if (e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((response) => {
          if (response.ok && !url.pathname.startsWith('/downloads/')) {
            const clone = response.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return response;
        }).catch(() => {
          // Offline fallback for navigation
          if (e.request.mode === 'navigate') {
            return caches.match('/');
          }
        });
      })
    );
  }
});
