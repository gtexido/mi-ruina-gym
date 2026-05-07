const CACHE = 'rutina-agent-squad-v8';
const CORE = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.hostname.includes('docs.google.com') || url.hostname.includes('youtube.com') || url.hostname.includes('googlevideo.com')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(fetch(event.request).then(res => {
    if (res && res.ok) {
      const clone = res.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, clone));
    }
    return res;
  }).catch(() => caches.match(event.request)));
});
