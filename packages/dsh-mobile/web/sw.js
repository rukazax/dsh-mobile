/* DSH Mobile service worker.
 * - app shell: stale-while-revalidate, versioned cache;
 * - navigations: network-first (fresh HTML when the host is reachable), offline.html fallback;
 * - /api/**: never intercepted, never cached (SSE included).
 * Relative URLs only: the PWA can be served from any sub-path by the plugin gateway.
 */
const VERSION = 'v1';
const CACHE = `dshm-shell-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './styles/tokens.css',
  './styles/layout.css',
  './styles/components.css',
  './js/main.js',
  './js/dom.js',
  './js/store.js',
  './js/i18n.js',
  './js/db.js',
  './js/api.js',
  './js/sse.js',
  './js/markdown.js',
  './js/router.js',
  './js/demo.js',
  './js/sessions.js',
  './js/chat.js',
  './js/settings.js',
  './js/pair.js',
  './js/lab.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

const API_RE = /(^|\/)api\/(v\d+\/)?/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('dshm-shell-') && n !== CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // API may live on another origin
  if (API_RE.test(url.pathname)) return; // never touch the gateway API or SSE
  if (url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match('./index.html'));
    if (cached) return cached;
    const offline = await cache.match('./offline.html');
    if (offline) return offline;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const response = await network;
  if (response) return response;
  return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
