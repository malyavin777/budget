/* Service worker: приложение открывается мгновенно и без сети.
 * Свои файлы — из кэша, обновление в фоне. Запросы к бэкенду не трогаем.
 * При изменении файлов приложения увеличьте VERSION.
 */
const VERSION = 'budget-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app/app.css?v=1',
  './app/app.js?v=1',
  './app/icons/icon.svg',
  './app/icons/icon-192.png',
  './app/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'budget-fonts').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // шрифты Google — кэш навсегда
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open('budget-fonts').then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      c.put(req, res.clone());
      return res;
    }))));
    return;
  }

  if (url.origin !== self.location.origin) return; // бэкенд и прочее — напрямую

  // своё: из кэша, а в фоне обновляем
  const key = req.mode === 'navigate' ? './index.html' : req;
  event.respondWith(caches.open(VERSION).then((c) => c.match(key).then((hit) => {
    const net = fetch(req).then((res) => {
      if (res.ok) c.put(key, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  })));
});
