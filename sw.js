/* Service worker for the shop. Push while the browser is closed requires a configured push sender/VAPID keys. */
const STATIC_CACHE = 'maison-static-v2';
const STATIC_ASSETS = new Set([
  'css/design-system.css',
  'css/style.css',
  'css/auth.css',
  'css/admin.css',
  'css/messages.css',
  'css/profile.css',
  'css/legal.css',
  'css/theme.css',
  'js/config.js',
  'js/legal-notice.js',
  'js/supabase-store.js',
  'js/auth.js',
  'js/profile.js',
  'js/catalog.js',
  'js/price-utils.js',
  'js/app.js',
  'js/featured-product.js',
  'js/pages.js',
  'js/messages.js',
  'js/account-admin.js',
  'js/animations.js',
  'js/theme.js',
  'manifest.webmanifest',
  'icon.svg'
]);

self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys
    .filter(key => key.startsWith('maison-static-') && key !== STATIC_CACHE)
    .map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scopePath = new URL(self.registration.scope).pathname;
  if (request.method !== 'GET' || url.origin !== self.location.origin
      || !url.pathname.startsWith(scopePath)
      || !STATIC_ASSETS.has(url.pathname.slice(scopePath.length))) return;

  event.respondWith((async () => {
    let cache;
    try {
      cache = await caches.open(STATIC_CACHE);
    } catch (error) {
      console.warn('Не удалось открыть кеш статических файлов:', error);
      return fetch(request);
    }

    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      try {
        await cache.put(request, response.clone());
      } catch (error) {
        console.warn('Не удалось сохранить статический файл в кеше:', request.url, error);
      }
    }
    return response;
  })());
});
self.addEventListener('push', event => {
  let data = { title: 'Старинная Коллекция', body: 'У вас новое сообщение', url: './#lk' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Старинная Коллекция', {
    body: data.body || 'У вас новое сообщение', icon: './icon.svg', badge: './icon.svg',
    data: { url: data.url || './#lk' }, tag: data.tag || 'shop-new-message', renotify: true
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close(); const url = new URL(event.notification.data?.url || './#lk', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) if ('focus' in client) { client.navigate(url); return client.focus(); }
    return self.clients.openWindow(url);
  }));
});
