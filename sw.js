const CACHE_NAME = 'kintore-v5';
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './logic.js',
  './sw.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names
        .filter(name => name.startsWith('kintore-') && name !== CACHE_NAME)
        .map(name => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.hostname === 'api.github.com' ||
    (url.origin !== self.location.origin && !FONT_HOSTS.includes(url.hostname))
  ) {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // App files: network first so a new deploy reaches the phone; cache only when offline. Fonts never change: cache first.
    if (url.origin === self.location.origin) {
      try {
        // no-cache: always revalidate with the server, so the browser's 10-minute HTTP cache never hides a deploy.
        const response = await fetch(request, { cache: 'no-cache' });
        if (response.ok) event.waitUntil(cache.put(request, response.clone()));
        return response;
      } catch {
        return (await cache.match(request)) ?? Response.error();
      }
    }
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      event.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  })());
});
