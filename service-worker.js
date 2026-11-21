/* Kayaos.space service worker
   - App files: network-first, bypassing the browser cache, so new uploads show up right away;
     the saved copy is only used offline.
   - CDN libraries (Leaflet, Supabase JS): cache-first.
   - Supabase API, geocoding, map tiles: never intercepted (always live data).
   - 'kayaos-tts' cache (saved AI voice clips) is kept across updates. */
const CACHE = 'kayaos-2026.11.21-106';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './apple-touch-icon.png', './favicon.ico',
  './icons/icon-48.png', './icons/icon-72.png', './icons/icon-96.png', './icons/icon-144.png', './icons/icon-192.png', './icons/icon-512.png'];
const CDN = ['unpkg.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && !k.startsWith('kayaos-tts')).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    /* cache:'no-cache' = always ask the server (skips stale browser-cached copies) */
    e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
    return;
  }
  if (CDN.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })));
  }
  /* everything else goes straight to the network */
});

/* Tapping a reminder notification brings Kayaos to the front */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./index.html');
  }));
});
