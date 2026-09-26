const CACHE = 'receipt-ledger-shell-v2';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg',
  './src/app.js', './src/core.js', './src/db.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Onlineでは同じ公開先から最新版を確認し、オフラインでは端末キャッシュを使う。
  // 支出データや質問内容をリクエストへ含める処理はない。
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && new URL(event.request.url).origin === self.location.origin) {
      const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    return event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error();
  }));
});
