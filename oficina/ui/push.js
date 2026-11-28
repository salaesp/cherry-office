/* Avisos en este teléfono (docs/plan-celular.md, fase 3): prender o apagar los avisos push de la oficina instalada.
   - Pide permiso al sistema (solo desde un toque), se suscribe con la clave VAPID de la oficina (GET /api/push) y anota la
     suscripción (POST /api/push/suscribir). El aviso lo muestra el service worker (sw.js).
   - En iPhone solo anda con la app agregada a la pantalla de inicio (iOS 16.4+): si no, se explica cómo instalarla.
   - Una tarjeta en Bandeja › Hoy lo ofrece una vez (y la de instalar, si hace falta); se apaga con «Ahora no».
   - En «Más»: avisos prendidos o apagados, una prueba y un horario de no molestar.
   Al tocar un aviso con la app abierta, el service worker le pide ir a esa pantalla.
   En la app de Android (?avisosId=… en la dirección) no se usa Web Push: Chrome no reconoce la app como dueña de la
   dirección de Tailscale y los avisos salían como de Chrome. Se anota el teléfono como `nativo:<id>` y la app los espera
   ella misma (android/…/AvisosNativos.kt); prenderlos le pide a la app que arranque (oficina-android://avisos-prender). */
window.App = window.App || {};
App.Push = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var api = function () { return App.api; };
  var esIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var instalada = !!((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone);
  var cache = null;   // último estado: {soportado, permiso, suscripto, endpoint, silencio}

  function soportado() {
    if (modoApp) return true;
    return !(App.nativo && App.nativo.hay) && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  /* iPhone en Safari, sin instalar: no hay push hasta agregarla a inicio */
  function faltaInstalar() { return esIOS && !instalada; }

  /* corta una espera que no termina nunca (en la app de Android, Chrome a veces no contesta) con un mensaje que diga dónde */
  function conTope(p, ms, mensaje) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error(mensaje)); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  /* la app de Android abre la oficina en Chrome (Trusted Web Activity): Chrome pasa el paquete como referrer */
  var enAppAndroid = /^android-app:\/\/app\.oficina\.android/.test(document.referrer || '');
  var dondeAjustes = enAppAndroid ? 'en Ajustes › Apps › Oficina › Notificaciones' : 'en los ajustes del sistema';
  /* lo que Android dice de los avisos de la app (MainActivity lo pasa como ?avisosApp=si|no); null si no vino */
  var avisosApp = (location.search.match(/[?&]avisosApp=(si|no)/) || [])[1] || null;
  /* qué preguntó Chrome a la app y qué le contestó (Delegacion.kt): se muestra con el error para poder diagnosticarlo */
  var avisosDiag = (function () { try { return decodeURIComponent((location.search.match(/[?&]avisosDiag=([^&]*)/) || [])[1] || ''); } catch (e) { return ''; } })();
  /* id de la app de Android para sus propios avisos (MainActivity): con él, los avisos son de la app y no de Chrome */
  var avisosId = (location.search.match(/[?&]avisosId=([A-Za-z0-9-]{8,64})(&|$)/) || [])[1] || null;
  var modoApp = !!avisosId;
  var endpointApp = modoApp ? 'nativo:' + avisosId : null;
  /* abre los ajustes de avisos de la app de Android misma (AjustesAvisos.kt), no los de otra «Oficina» */
  var URL_AJUSTES = 'intent://avisos#Intent;scheme=oficina-android;package=app.oficina.android;end';
  /* le pide a la app que empiece a esperar avisos (y, si hace falta, que Android no la frene para ahorrar batería) */
  var URL_PRENDER = 'intent://avisos-prender#Intent;scheme=oficina-android;package=app.oficina.android;end';
  function sinPermiso(p) {
    var e;
    if (!enAppAndroid) {
      e = new Error(p === 'denied' ? 'El teléfono tiene los avisos bloqueados para esta app: habilitalos ' + dondeAjustes + '.' : 'No diste permiso para avisos.');
    } else if (avisosApp === 'no') {
      e = new Error('Android tiene apagados los avisos de esta app. Tocá «Abrir ajustes de avisos», prendelos, y después cerrá y volvé a abrir la app.');
    } else {
      e = new Error('Chrome no le da permiso de avisos a la oficina (contestó «' + p + '»)' +
        (avisosApp === 'si' ? ', aunque Android dice que esta app los tiene prendidos' : '') +
        '. Tocá «Abrir ajustes de avisos» para revisar los de esta app (puede haber otra «Oficina», la instalada desde Chrome), y después cerrá y volvé a abrir la app.');
    }
    e.ajustes = enAppAndroid;
    e.diag = enAppAndroid ? avisosDiag : '';
    return e;
  }
  /* el error en pantalla y, en la app de Android, el botón para ir a sus ajustes */
  function mostrarError(caja, x) {
    App.vaciar(caja);
    App.add(caja, h('div', x.message || String(x)));
    if (x.diag) App.add(caja, h('div', { style: { marginTop: '6px', fontSize: '12px', opacity: 0.75, userSelect: 'text', wordBreak: 'break-all' } }, 'Detalle: ' + x.diag));
    if (x.ajustes) App.add(caja, h('div', { style: { marginTop: '8px' } },
      h('button.btn.chico', { onclick: function () { location.href = URL_AJUSTES; } }, App.icono('campana'), 'Abrir ajustes de avisos')));
  }

  function registro() {
    return conTope(navigator.serviceWorker.getRegistration().then(function (r) { return r || navigator.serviceWorker.register('sw.js'); })
      .then(function () { return navigator.serviceWorker.ready; }), 15000, 'La parte de la oficina que recibe avisos no arrancó. Cerrá la app y volvé a abrirla.');
  }
  function claveBytes(b64) {
    var s = (b64 + '==='.slice((b64.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/'), bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function nombreDispositivo() {
    var ua = navigator.userAgent;
    return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : 'Celular';
  }

  /* ---------------- avisos de la app de Android ---------------- */
  function estadoApp() {
    return api().get('/api/push').then(function (r) {
      var mia = (r.suscripciones || []).filter(function (x) { return x.endpoint === endpointApp; })[0];
      if (mia) quitarWebPush();
      return { soportado: true, app: true, permiso: avisosApp === 'no' ? 'denied' : 'granted', suscripto: !!mia, endpoint: endpointApp, silencio: mia && mia.silencio };
    }).then(function (e) { cache = e; return e; })
      .catch(function () { return cache = { soportado: true, app: true, permiso: 'granted', suscripto: false, endpoint: endpointApp }; });
  }
  /* los de Chrome (si quedaron de antes) se borran: si no, cada aviso llegaría dos veces */
  var webQuitado = false;
  function quitarWebPush() {
    if (webQuitado || !('serviceWorker' in navigator)) return;
    webQuitado = true;
    navigator.serviceWorker.getRegistration().then(function (reg) { return reg && reg.pushManager && reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return sub.unsubscribe().then(function () { return api().post('/api/push/desuscribir', { endpoint: ep }); });
    }).catch(function () {});
  }
  function activarApp() {
    if (avisosApp === 'no') {
      var e = new Error('Android tiene apagados los avisos de esta app. Tocá «Abrir ajustes de avisos», prendelos, y después cerrá y volvé a abrir la app.');
      e.ajustes = true;
      return Promise.reject(e);
    }
    /* primero, todavía dentro del toque (si no, Chrome puede no dejar abrir la app): que la app empiece a esperar */
    location.href = URL_PRENDER;
    return api().post('/api/push/suscribir', { nativo: { id: avisosId }, nombre: 'Android (app)' }).then(function () {
      quitarWebPush();
      /* la prueba queda guardada en la oficina hasta que la app la venga a buscar */
      api().post('/api/push/probar', { endpoint: endpointApp }).catch(function () {});
    }).then(estadoApp);
  }

  function estado() {
    if (modoApp) return estadoApp();
    if (!soportado()) return Promise.resolve(cache = { soportado: false, permiso: 'no', suscripto: false });
    return registro().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return { soportado: true, permiso: Notification.permission, suscripto: false };
      return api().get('/api/push').then(function (r) {
        var mia = (r.suscripciones || []).filter(function (x) { return x.endpoint === sub.endpoint; })[0];
        return { soportado: true, permiso: Notification.permission, suscripto: !!mia, endpoint: sub.endpoint, silencio: mia && mia.silencio };
      });
    }).then(function (e) { cache = e; return e; }).catch(function () { return cache = { soportado: true, permiso: Notification.permission, suscripto: false }; });
  }

  /* prender: permiso del sistema → suscripción con la clave de la oficina → anotarla. Rechaza con un texto para mostrar. */
  function activar() {
    if (modoApp) return activarApp();
    if (!soportado()) return Promise.reject(new Error(faltaInstalar() ? 'Primero agregá la app a la pantalla de inicio.' : 'Este navegador no puede recibir avisos.'));
    var pedido = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    return conTope(pedido, 60000, 'El teléfono no contestó el pedido de permiso. Habilitá los avisos ' + dondeAjustes + ' y probá de nuevo.').then(function (p) {
      if (p !== 'granted') throw sinPermiso(p);
      return Promise.all([registro(), api().get('/api/push')]);
    }).then(function (rs) {
      var reg = rs[0], clave = claveBytes(rs[1].clave);
      var suscribir = function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave }); };
      /* una suscripción vieja con otra clave (otra instalación) no sirve: se cambia */
      return conTope(reg.pushManager.getSubscription().then(function (vieja) {
        return vieja ? vieja.unsubscribe().then(suscribir) : suscribir();
      }), 30000, 'Chrome no terminó de anotarse para avisos: necesita los servicios de Google Play e internet (no alcanza con Tailscale)')
        .catch(function (e) { throw new Error('No pude anotar este teléfono para avisos (' + (e && e.message || e) + ').'); });
    }).then(function (sub) {
      return api().post('/api/push/suscribir', { suscripcion: sub.toJSON(), nombre: nombreDispositivo() }).then(function () { return sub; });
    }).then(function (sub) {
      /* la prueba sale sola: no hace falta esperar a que llegue para mostrar que quedaron prendidos */
      api().post('/api/push/probar', { endpoint: sub.endpoint }).catch(function () {});
    }).then(estado);
  }

  function desactivar() {
    if (modoApp) return api().post('/api/push/desuscribir', { endpoint: endpointApp }).then(estadoApp);
    return registro().then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return null;
      var ep = sub.endpoint;
      return sub.unsubscribe().then(function () { return api().post('/api/push/desuscribir', { endpoint: ep }).catch(function () {}); });
    }).then(estado);
  }

  /* ---------------- hoja «Avisos en este teléfono» ---------------- */
  function hoja() {
    var hj = App.hoja({ titulo: 'Avisos en este teléfono', ancho: 460 });
    function pintar(e) {
      var c = App.vaciar(hj.cuerpo), err = h('div.error-txt');
      if (!e.soportado) {
        App.add(c, faltaInstalar() ? instrucciones() : h('p', 'Este navegador no puede recibir avisos. Probá con la app instalada (Chrome en Android, o agregada a inicio en iPhone).'));
        return;
      }
      var llave = App.elegir({ forma: 'interruptor', etiqueta: 'Avisos', valor: !!e.suscripto,
        opciones: [{ valor: true, titulo: 'Prendidos' }, { valor: false, titulo: 'Apagados' }],
        alCambiar: function (v) {
          err.textContent = '';
          espera.textContent = v ? 'Prendiendo los avisos…' : 'Apagando…';
          (v ? activar() : desactivar()).then(pintar).catch(function (x) { espera.textContent = ''; mostrarError(err, x); llave.poner(!v); });
        } });
      var espera = h('p.ayuda');
      App.add(c,
        h('p.ayuda', { style: { marginTop: 0 } }, 'Te aviso cuando algo te espera: un permiso, una pregunta, te toca en un flujo o hay algo para revisar. ' +
          'Llegan desde la compu de la oficina: si está apagada o dormida, no hay avisos.' +
          (e.app ? ' Mientras estén prendidos, Android muestra un aviso fijo de la app («Avisos de la oficina»): lo podés silenciar desde el mismo aviso.' : '')),
        App.ajuste('Avisos', null, llave), espera, err);
      if (!e.suscripto) return;
      var sil = !!e.silencio, desde = (e.silencio && e.silencio.desde) || '23:00', hasta = (e.silencio && e.silencio.hasta) || '08:00';
      var horas = function (v, alCambiar) {
        var s = h('select.campo', { style: { width: 'auto' }, onchange: function () { alCambiar(s.value); } });
        for (var i = 0; i < 24; i++) { var t = (i < 10 ? '0' : '') + i + ':00'; s.appendChild(h('option', { value: t, selected: t === v }, t)); }
        return s;
      };
      var guardar = function () {
        api().put('/api/push/silencio', sil ? { endpoint: e.endpoint, desde: desde, hasta: hasta } : { endpoint: e.endpoint, desde: null })
          .then(function () { App.guardado(sil ? 'No molestar de ' + desde + ' a ' + hasta + '.' : 'Sin horario de no molestar.'); })
          .catch(function (x) { err.textContent = x.message; });
      };
      var rango = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' } },
        'de', horas(desde, function (v) { desde = v; guardar(); }), 'a', horas(hasta, function (v) { hasta = v; guardar(); }));
      rango.classList.toggle('oculto', !sil);
      App.add(c,
        App.ajuste('No molestar', 'En ese horario no llegan avisos (lo pendiente sigue en la Bandeja).',
          App.elegir({ forma: 'interruptor', etiqueta: 'No molestar', valor: sil, opciones: [{ valor: true, titulo: 'Sí' }, { valor: false, titulo: 'No' }],
            alCambiar: function (v) { sil = v; rango.classList.toggle('oculto', !v); guardar(); } })),
        rango,
        h('div', { style: { marginTop: '14px' } }, h('button.btn.chico', { onclick: function () {
          api().post('/api/push/probar', { endpoint: e.endpoint }).then(function () { App.aviso('Te mandé un aviso de prueba.'); }).catch(function (x) { err.textContent = x.message; });
        } }, App.icono('campana'), 'Mandar uno de prueba')));
    }
    App.add(hj.cuerpo, App.cargando('Revisando…'));
    estado().then(pintar);
  }

  function instrucciones() {
    return h('div.push-instalar',
      h('b', 'Agregá la Oficina a la pantalla de inicio'),
      h('p', esIOS ? 'En iPhone los avisos solo llegan a la app instalada.' : 'Así se abre como una app y puede avisarte.'),
      h('ol',
        h('li', esIOS ? 'Tocá Compartir (el cuadrado con la flecha) en Safari.' : 'Tocá el menú ⋮ de Chrome.'),
        h('li', esIOS ? 'Elegí «Agregar a inicio».' : 'Elegí «Instalar app» o «Agregar a la pantalla principal».'),
        h('li', 'Abrila desde el ícono y prendé los avisos.')));
  }

  /* para el menú «Más» del modo celular */
  function itemMenu() {
    if (App.nativo && App.nativo.hay && !modoApp) return null;
    var nota = !soportado() ? (faltaInstalar() ? 'instalá la app' : 'no disponible') : cache && cache.suscripto ? 'Prendidos' : 'Apagados';
    return { texto: 'Avisos en este teléfono', icono: 'campana', nota: nota, accion: hoja };
  }

  /* tarjeta para Bandeja › Hoy (una vez): instalar, o prender los avisos */
  function descartado(k) { try { return localStorage.getItem('oficina.push.' + k) === '1'; } catch (e) { return false; } }
  function descartar(k) { try { localStorage.setItem('oficina.push.' + k, '1'); } catch (e) {} }
  function tarjeta(alCambiar) {
    if (!App.movil) return null;
    if (faltaInstalar() && !descartado('instalar')) {
      var t1 = h('div.push-tarjeta', instrucciones(),
        h('div.acciones', h('button.btn.chico', { onclick: function () { descartar('instalar'); t1.remove(); } }, 'Ahora no')));
      return t1;
    }
    if (!soportado() || descartado('ofrecer') || (cache && cache.suscripto) || (!modoApp && Notification.permission === 'denied')) return null;
    if (!cache) { estado().then(function (e) { if (!e.suscripto && alCambiar) alCambiar(); }); return null; }
    var err = h('div.error-txt');
    var t2 = h('div.push-tarjeta',
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start' } }, App.icono('campana'),
        h('div', h('b', '¿Te aviso en este teléfono?'), h('p', 'Cuando un agente te pida permiso, te pregunte algo o te deje algo para revisar.'))),
      err,
      h('div.acciones',
        h('button.btn.chico', { onclick: function () { descartar('ofrecer'); t2.remove(); } }, 'Ahora no'),
        h('button.btn.chico.primario', { onclick: function () {
          var b = this;
          err.textContent = '';
          b.disabled = true; b.textContent = 'Prendiendo…';
          activar().then(function () { t2.remove(); App.aviso('Avisos prendidos.'); })
            .catch(function (x) { mostrarError(err, x); b.disabled = false; b.textContent = 'Prender avisos'; });
        } }, 'Prender avisos')));
    return t2;
  }

  /* al tocar un aviso con la app abierta: ir a esa pantalla */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (ev) {
      var d = ev.data || {};
      if (d.tipo !== 'ir' || typeof d.url !== 'string') return;
      try { var u = new URL(d.url, location.href); if (u.origin === location.origin && u.hash) location.hash = u.hash; } catch (e) {}
    });
  }
  if (App.movil && soportado()) setTimeout(estado, 0);

  return { soportado: soportado, estado: estado, activar: activar, desactivar: desactivar, hoja: hoja, itemMenu: itemMenu, tarjeta: tarjeta };
})();
