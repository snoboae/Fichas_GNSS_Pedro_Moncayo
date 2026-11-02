/* Service worker: la app abre y funciona sin conexión.
   - Archivos de la app: caché con actualización en segundo plano.
   - Teselas del mapa satelital: caché con límite (las que ya se vieron o generaron). */
const VERSION = 'v3cac27f8';
const APP_CACHE = 'ig-app-' + VERSION;
const TILE_CACHE = 'ig-tiles-v1';
const MAX_TILES = 3000;

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'img/geocaliza.png',
  'img/pedro-moncayo.png',
  'js/config.js',
  'js/datos.js',
  'js/logos.js',
  'js/geo.js',
  'js/db.js',
  'js/fotos.js',
  'js/mapimg.js',
  'js/zip.js',
  'js/pdf.js',
  'js/drive.js',
  'js/app.js',
  'lib/jspdf/jspdf.umd.min.js',
  // croquis de los 22 puntos, generados con herramientas/genera_croquis.py
  'img/croquis/RG-50-01.jpg',
  'img/croquis/RG-50-02.jpg',
  'img/croquis/RG-50-03.jpg',
  'img/croquis/RG-50-04.jpg',
  'img/croquis/RG-50-05.jpg',
  'img/croquis/RG-50-06.jpg',
  'img/croquis/RG-51-01.jpg',
  'img/croquis/RG-51-02.jpg',
  'img/croquis/RG-51-03.jpg',
  'img/croquis/RG-52-01.jpg',
  'img/croquis/RG-52-02.jpg',
  'img/croquis/RG-52-03.jpg',
  'img/croquis/RG-52-04.jpg',
  'img/croquis/RG-53-01.jpg',
  'img/croquis/RG-53-02.jpg',
  'img/croquis/RG-53-03.jpg',
  'img/croquis/RG-53-04.jpg',
  'img/croquis/RG-54-01.jpg',
  'img/croquis/RG-54-02.jpg',
  'img/croquis/RG-54-03.jpg',
  'img/croquis/RG-54-04.jpg',
  'img/croquis/RG-SF-51-01.jpg',
  'img/croquis/PCA01.jpg',
  'img/croquis/PCA03.jpg',
  'img/croquis/PCA04.jpg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

const TILE_HOSTS = ['server.arcgisonline.com', 'tile.openstreetmap.org'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then((c) => Promise.all(APP_FILES.map((u) => fetch(new Request(u, { cache: 'reload' }))
        .then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return c.put(u, r); }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ig-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
  // avisa a la app para mostrar "Hay una versión nueva"
  self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ tipo: 'nueva-version', version: VERSION })));
});

/* La app puede pedir que se active de inmediato o preguntar qué versión corre. */
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.tipo === 'activar') { self.skipWaiting(); return; }
  if (d.tipo === 'version' && e.source && e.source.postMessage) {
    e.source.postMessage({ tipo: 'version', version: VERSION });
  }
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  if (keys.length > MAX_TILES) {
    const extra = keys.length - MAX_TILES;
    for (let i = 0; i < extra; i++) await c.delete(keys[i]);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // el mapa satelital se guarda aparte (y así el croquis ya visto sirve sin datos)
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          cache.put(req, res.clone());
          if (Math.random() < 0.02) trimTiles();
        }
        return res;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (hit) { net.catch(() => {}); return hit; }
      const res = await net;
      if (res) return res;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    })());
  }
});
