/* Calorie Tracker service worker — full offline app shell.
 *
 * Assets are served cache-first for an instant offline start, then refreshed
 * from the network in the background. A deploy therefore reaches installed
 * clients on their next launch without needing a version bump.
 *
 * Bump VERSION when you want to force every client to drop its cache at once
 * (a rebuild from scratch, e.g. after changing the precache list).
 */

const VERSION = 'ct-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './js/foods.js',
  './js/nutrition.js',
  './js/ui.js',
  './js/charts.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
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
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Only ever read from this version's cache, never a stale one.
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);

      // Navigations resolve to the cached shell so the app opens offline.
      const key = request.mode === 'navigate' ? './index.html' : request;

      const network = fetch(request)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);

      // Keep the worker alive long enough to finish the background refresh.
      event.waitUntil(network);

      const cached = await cache.match(key);
      if (cached) return cached;

      return (await network) || new Response('', { status: 504, statusText: 'Offline' });
    })()
  );
});