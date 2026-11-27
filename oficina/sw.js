/* Service worker de la Oficina instalada (docs/plan-celular.md, fase 1). Hace dos cosas, nada más:
   - la interfaz (index, ui/, vendor/, íconos) se pide siempre a la red primero y se guarda una copia solo como respaldo,
     así `actualizar.sh` o una versión nueva de la app de escritorio se ven al recargar, sin quedar pegado a JS viejo;
   - sin conexión, en vez del error del navegador, muestra la última copia o una pantalla que explica qué pasa.
   /api/* no se toca nunca: va directo a la red.
   Además (fase 3) muestra los avisos push que manda la oficina (backend/src/push.ts) y, al tocarlos, abre la app en lo
   que corresponde; un permiso se puede contestar desde el aviso (Permitir / No) donde el sistema muestra botones. */
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

/* ---------------- compartir hacia la Oficina (fase 4) ----------------
   El manifest declara un share_target: lo que se comparte desde otra app llega como POST /compartir (multipart). Acá se
   guarda en IndexedDB y se abre la app en #/compartir, donde se elige qué hacer (ui/compartir.js). El servidor no lo ve. */
function idb() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open('oficina', 1);
    r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('compartido')) r.result.createObjectStore('compartido', { keyPath: 'id' }); };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
function recibirCompartido(req) {
  return req.formData().then(function (fd) {
    var archivos = fd.getAll('archivos').filter(function (f) { return f && typeof f === 'object' && f.size > 0; }).slice(0, 10).map(function (f) {
      return { nombre: f.name || 'archivo', tipo: f.type || '', datos: f };
    });
    var item = { id: 'ultimo', ts: Date.now(), titulo: String(fd.get('titulo') || ''), texto: String(fd.get('texto') || ''), url: String(fd.get('url') || ''), archivos: archivos };
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('compartido', 'readwrite');
        tx.objectStore('compartido').put(item);
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    });
  }).then(function () { return Response.redirect('/?movil=1#/compartir', 303); },
    function () { return Response.redirect('/?movil=1#/compartir/error', 303); });
}

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method === 'POST' && new URL(req.url).pathname === '/compartir') { ev.respondWith(recibirCompartido(req)); return; }
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

/* ---------------- avisos push ---------------- */
self.addEventListener('push', function (ev) {
  var m = {};
  try { m = ev.data ? ev.data.json() : {}; } catch (e) { m = { titulo: 'Oficina', texto: ev.data ? ev.data.text() : '' }; }
  var op = {
    body: m.texto || '', icon: 'iconos/icono-192.png', lang: 'es',
    tag: m.tag || undefined, renotify: !!m.tag,
    data: { url: m.url || '/?movil=1#/bandeja/hoy', permiso: m.permiso || null }
  };
  if (m.permiso && m.acciones) op.actions = [{ action: 'una_vez', title: 'Permitir' }, { action: 'rechazar', title: 'No' }];
  ev.waitUntil(self.registration.showNotification(m.titulo || 'Oficina', op));
});

self.addEventListener('notificationclick', function (ev) {
  var n = ev.notification, d = n.data || {};
  n.close();
  /* Permitir / No desde el aviso: se contesta sin abrir la app */
  if (d.permiso && (ev.action === 'una_vez' || ev.action === 'rechazar')) {
    ev.waitUntil(fetch('/api/permisos/' + encodeURIComponent(d.permiso), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: ev.action })
    }).catch(function () {}));
    return;
  }
  var url = new URL(d.url || '/?movil=1#/bandeja/hoy', self.location.origin).href;
  ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) {
      if (new URL(cs[i].url).origin === self.location.origin && 'focus' in cs[i]) {
        cs[i].postMessage({ tipo: 'ir', url: url });
        return cs[i].focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
