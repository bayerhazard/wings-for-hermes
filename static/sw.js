/**
 * Wings for Hermes Service Worker — DISABLED
 * The SW caused stale-cache issues that prevented updates from reaching
 * the browser. This no-op SW unregisters itself and deletes all caches
 * so the browser always fetches fresh from the network.
 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Pass-through: never intercept any request
self.addEventListener('fetch', (event) => {
  // Let the browser handle everything normally
});
