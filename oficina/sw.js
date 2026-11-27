/* Service worker de la Oficina instalada (docs/plan-celular.md, fase 1). Hace dos cosas, nada más:
   - la interfaz (index, ui/, vendor/, íconos) se pide siempre a la red primero y se guarda una copia solo como respaldo,
     así `actualizar.sh` o una versión nueva de la app de escritorio se ven al recargar, sin quedar pegado a JS viejo;
   - sin conexión, en vez del error del navegador, muestra la última copia o una pantalla que explica qué pasa.
   /api/* no se toca nunca: va directo a la red. */
'use strict';
var CACHE = 'oficina-ui-v1';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function deLaInterfaz(url) {
  if (url.origin !== self.location.origin) return false;
  var p = url.pathname;
  return p === '/' || p === '/index.html' || p === '/manifest.webmanifest' || p === '/logo-prospera.svg' ||
    p.indexOf('/ui/') === 0 || p.indexOf('/vendor/') === 0 || p.indexOf('/iconos/') === 0;
}

var SIN_RED = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Oficina</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f0ec;color:#1d1d1f;' +
  'font:15px/1.5 -apple-system,system-ui,sans-serif;padding:24px;box-sizing:border-box;text-align:center}' +
  '@media (prefers-color-scheme:dark){body{background:#19191b;color:#f1f1f2}}p{color:#6d6962;max-width:32ch;margin:8px auto 20px}' +
  'button{font:inherit;height:40px;padding:0 18px;border-radius:10px;border:0;background:#1d1d1f;color:#fff}' +
  '@media (prefers-color-scheme:dark){button{background:#f1f1f2;color:#1b1b1d}}</style></head><body><div>' +
  '<h2 style="margin:0">Sin conexión con la Oficina</h2>' +
  '<p>Fijate que Tailscale esté prendido en este teléfono y que la compu de la oficina esté prendida, despierta y con la app abierta.</p>' +
  '<button onclick="location.reload()">Reintentar</button></div></body></html>';

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.pathname.indexOf('/api/') === 0 || !deLaInterfaz(url)) return;
  ev.respondWith(fetch(req).then(function (res) {
    if (res.ok) { var copia = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copia); }); }
    /* con la app de escritorio cerrada, `tailscale serve` contesta 502: es lo mismo que no tener conexión */
    if (res.status >= 502 && res.status <= 504) throw new Error('sin oficina');
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (r) {
      if (r) return r;
      if (req.mode === 'navigate') return new Response(SIN_RED, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return Response.error();
    });
  }));
});
