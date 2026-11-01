/* The desktop build is already offline. This cache is for the browser/PWA edition. */
const CACHE_PREFIX = 'focuslens-';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/precache-manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Offline manifest unavailable');
    const manifest = await response.json();
    const cache = await caches.open(CACHE_PREFIX + manifest.version);
    await cache.addAll(manifest.urls);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const response = await fetch('/precache-manifest.json', { cache: 'no-store' }).catch(() => null);
    if (response?.ok) {
      const manifest = await response.json();
      await Promise.all((await caches.keys()).filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_PREFIX + manifest.version).map(key => caches.delete(key)));
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!['GET', 'HEAD'].includes(event.request.method) || url.origin !== self.location.origin) return;
  // A static export has no query-dependent responses. Next adds a different
  // _rsc cache key during every navigation; cached files use their clean URL.
  let pathname = url.pathname;
  if (pathname === '/favicon.ico') pathname = '/icons/icon-192.png';
  if (event.request.headers.get('RSC') === '1' && !/\.[^/]+$/.test(pathname)) {
    pathname = pathname.replace(/\/$/, '') + '/index.txt';
  } else if (!/\.[^/]+$/.test(pathname)) {
    pathname = pathname.replace(/\/$/, '') + '/index.html';
  }
  event.respondWith((async () => {
    const cached = await caches.match(pathname);
    if (cached) return event.request.method === 'HEAD'
      ? new Response(null, { status: cached.status, statusText: cached.statusText, headers: cached.headers })
      : cached;
    return fetch(event.request);
  })());
});
