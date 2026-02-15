// Raydar Service Worker - Enhanced PWA with Aggressive Updates
const CACHE_VERSION = Date.now(); // Timestamp-based versioning
const CACHE_NAME = `raydar-v${CACHE_VERSION}`;
const OFFLINE_URL = '/offline';

console.log('[SW] Cache version:', CACHE_NAME);

// Files to cache immediately
const PRECACHE_ASSETS = [
  '/',
  '/offline',
  '/icon-192.png',
  '/icon-512.png',
  '/raydar-horizontal.png',
];

// Install event - cache core assets and activate immediately
self.addEventListener('install', (event) => {
  console.log('[SW] Installing new version:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.error('[SW] Failed to cache assets:', err);
      });
    })
  );
  // Skip waiting - activate immediately even if old service worker is running
  self.skipWaiting();
});

// Activate event - clean up old caches and take control immediately
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating new version:', CACHE_NAME);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      // Delete ALL old caches
      const deletePromises = cacheNames
        .filter((name) => name !== CACHE_NAME)
        .map((name) => {
          console.log('[SW] Deleting old cache:', name);
          return caches.delete(name);
        });
      return Promise.all(deletePromises);
    }).then(() => {
      // Take control of all pages immediately (don't wait for refresh)
      return self.clients.claim();
    })
  );
});

// Message event - handle update requests from pages
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    console.log('[SW] Received SKIP_WAITING message');
    self.skipWaiting();
  }
});

// Fetch event - network first for HTML, cache for assets
self.addEventListener('fetch', (event) => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Network first for HTML pages (always get fresh content)
  if (event.request.mode === 'navigate' || event.request.headers.get('accept').includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone and cache successful HTML responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fall back to cache if network fails
          return caches.match(event.request);
        })
    );
    return;
  }

  // Network first strategy for API calls
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone and cache successful responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fall back to cache if network fails
          return caches.match(event.request);
        })
    );
    return;
  }

  // Cache first for static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((response) => {
        // Cache successful responses
        if (response.ok && event.request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
    })
  );
});
