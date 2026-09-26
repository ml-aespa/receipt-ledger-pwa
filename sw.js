const CACHE = 'receipt-ledger-shell-v4-ocr-photo';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg',
  './src/app.js', './src/core.js', './src/db.js', './src/ocr.js',
  './vendor/ocr/tesseract.min.js', './vendor/ocr/worker.min.js',
  './vendor/ocr/lang/jpn.traineddata.gz', './vendor/ocr/lang/eng.traineddata.gz',
  './vendor/ocr/core/tesseract-core.js', './vendor/ocr/core/tesseract-core.wasm', './vendor/ocr/core/tesseract-core.wasm.js',
  './vendor/ocr/core/tesseract-core-lstm.js', './vendor/ocr/core/tesseract-core-lstm.wasm', './vendor/ocr/core/tesseract-core-lstm.wasm.js',
  './vendor/ocr/core/tesseract-core-simd.js', './vendor/ocr/core/tesseract-core-simd.wasm', './vendor/ocr/core/tesseract-core-simd.wasm.js',
  './vendor/ocr/core/tesseract-core-simd-lstm.js', './vendor/ocr/core/tesseract-core-simd-lstm.wasm', './vendor/ocr/core/tesseract-core-simd-lstm.wasm.js',
  './vendor/ocr/core/tesseract-core-relaxedsimd.js', './vendor/ocr/core/tesseract-core-relaxedsimd.wasm', './vendor/ocr/core/tesseract-core-relaxedsimd.wasm.js',
  './vendor/ocr/core/tesseract-core-relaxedsimd-lstm.js', './vendor/ocr/core/tesseract-core-relaxedsimd-lstm.wasm', './vendor/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js'
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
