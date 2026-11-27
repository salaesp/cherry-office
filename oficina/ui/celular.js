/* Ajustes › Celular (solo en la app de escritorio; docs/plan-celular.md, opción A): prender el acceso desde el celular.
   La app publica la oficina en la red de Tailscale (https, solo para los dispositivos de esa red) y muestra la dirección y
   un QR para abrirla en el celular e instalarla. Cada estado dice qué falta y cómo seguir. La app avisa cuando el estado
   cambia (App.Celular.refrescar). */
window.App = window.App || {};
App.Celular = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var ultimo = null, hoja = null;

  var DESCARGA = 'https://tailscale.com/download';

  function nota() {
    if (!ultimo || !ultimo.prendido) return '';
    return ultimo.estado === 'listo' ? 'Prendido' : 'Falta algo';
  }

  /* lo que falta, según el estado que devuelve la app */
  function queFalta(e) {
    switch (e.estado) {
      case 'probando': return { texto: 'Revisando Tailscale…', giro: true };
      case 'sin-tailscale': return {
        texto: 'Esta compu no tiene Tailscale. Instalalo acá y en el celular, y entrá con la misma cuenta en los dos.',
        boton: ['Bajar Tailscale', function () { abrirLink(DESCARGA); }] };
      case 'tailscale-apagado': return {
        texto: 'Tailscale está instalado pero apagado o sin sesión. Abrilo, iniciá sesión y conectalo.' };
      case 'sin-nombre': return {
        texto: 'Tailscale está conectado pero la red no tiene MagicDNS. Prendelo en la consola de Tailscale (DNS › MagicDNS).',
        boton: ['Abrir la consola', function () { abrirLink('https://login.tailscale.com/admin/dns'); }] };
      case 'falta-https': return {
        texto: 'Falta habilitar HTTPS en tu red de Tailscale (una sola vez). Sin eso el celular no puede usar el micrófono.',
        boton: ['Habilitar en Tailscale', function () { abrirLink(e.habilitar || 'https://login.tailscale.com/admin/dns'); }] };
      case 'error': return { texto: e.error || 'No pude publicar la oficina en Tailscale.', error: true };
      default: return null;
    }
  }

  function abrirLink(url) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hq) window.webkit.messageHandlers.hq.postMessage({ accion: 'open', url: url });
    else window.open(url, '_blank', 'noopener');
  }

  function svg(texto) {
    try {
      var doc = new DOMParser().parseFromString(texto, 'image/svg+xml');
      var el = doc.documentElement;
      if (!el || el.nodeName.toLowerCase() !== 'svg') return null;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Código QR con la dirección de la oficina');
      return document.importNode(el, true);
    } catch (e) { return null; }
  }

  function pintar(crear) {
    var hj = crear({ titulo: 'Celular', alCerrar: function () { hoja = null; } });
    hoja = hj;
    App.add(App.vaciar(hj.cuerpo), App.cargando('Revisando…'));
    App.nativo.celular('estado').then(function (e) { if (hoja === hj) dibujar(hj, e); })
      .catch(function () { if (hoja === hj) App.add(App.vaciar(hj.cuerpo), h('div.error-txt', 'Esta versión de la app no tiene acceso desde el celular.')); });
  }

  function dibujar(hj, e) {
    ultimo = e || { prendido: false, estado: 'apagado' };
    var c = App.vaciar(hj.cuerpo), err = h('div.error-txt');
    var llave = App.elegir({ forma: 'interruptor', etiqueta: 'Acceso desde el celular', valor: !!ultimo.prendido,
      opciones: [{ valor: true, titulo: 'Prendido' }, { valor: false, titulo: 'Apagado' }],
      alCambiar: function (v) {
        err.textContent = '';
        if (v) dibujar(hj, { prendido: true, estado: 'probando' });
        App.nativo.celular(v ? 'prender' : 'apagar').then(function (r) { if (hoja === hj) dibujar(hj, r); })
          .catch(function (x) { err.textContent = x.message || String(x); llave.poner(!v); });
      } });
    App.add(c,
      h('div.ayuda', { style: { marginTop: 0 } }, 'Abrí esta oficina desde el celular, como una app: contestar, aprobar, charlar y hablarle a la secretaría. ' +
        'La conexión va por Tailscale, así que solo entran tus dispositivos. Esta compu tiene que estar prendida y con Oficina abierta.'),
      App.ajuste('Acceso desde el celular', ultimo.prendido ? 'Mientras esté prendido, la compu no se suspende sola.' : null, llave),
      err);
    if (!ultimo.prendido) {
      App.add(c, pasos());
      return;
    }
    var falta = queFalta(ultimo);
    if (falta) {
      App.add(c, h('div.cel-falta' + (falta.error ? '.cel-error' : ''),
        falta.giro ? h('span.giro') : App.icono(falta.error ? 'alerta' : 'telefono'),
        h('div', h('p', falta.texto),
          h('div.cel-acc',
            falta.boton ? h('button.btn.primario.chico', { onclick: falta.boton[1] }, falta.boton[0]) : null,
            falta.giro ? null : h('button.btn.chico', { onclick: function () { probar(hj); } }, App.icono('recargar'), 'Volver a probar')))));
      if (ultimo.estado !== 'probando') App.add(c, pasos());
      return;
    }
    if (ultimo.estado === 'listo') {
      var qr = ultimo.qr ? svg(ultimo.qr) : null;
      App.add(c, h('div.cel-listo',
        qr ? h('div.cel-qr', qr) : null,
        h('div.cel-texto',
          h('b', 'Escanealo con la cámara del celular'),
          h('p', 'Con Tailscale prendido en el celular, se abre la oficina. Después:'),
          h('ul',
            h('li', h('b', 'iPhone:'), ' en Safari, Compartir › Agregar a inicio.'),
            h('li', h('b', 'Android:'), ' en Chrome, menú ⋮ › Instalar app.')),
          h('div.cel-url', h('code', ultimo.url),
            h('button.btn.chico', { onclick: function () {
              App.nativo.copiar(ultimo.url).then(function (ok) { App.aviso(ok === true ? 'Dirección copiada.' : 'No pude copiarla.', ok !== true); });
            } }, App.icono('copiar'), 'Copiar')))));
    }
  }

  function pasos() {
    return h('div.cel-pasos',
      h('b', 'Qué hace falta'),
      h('ol',
        h('li', 'Tailscale instalado en esta compu y en el celular, con la misma cuenta. ', h('a', { href: '#', onclick: function (ev) { ev.preventDefault(); abrirLink(DESCARGA); } }, 'Bajar Tailscale')),
        h('li', 'Prender el acceso acá. La primera vez, Tailscale puede pedir que habilites HTTPS en tu red: la app te lleva.'),
        h('li', 'Escanear el QR con el celular e instalar la app desde el navegador.')));
  }

  function probar(hj) {
    dibujar(hj, { prendido: true, estado: 'probando' });
    App.nativo.celular('probar').then(function (r) { if (hoja === hj) dibujar(hj, r); });
  }

  /* la app avisa cuando cambia el estado (p. ej. al levantarlo solo al abrir) */
  function refrescar() {
    App.nativo.celular('estado').then(function (e) {
      ultimo = e;
      if (hoja) dibujar(hoja, e);
    }).catch(function () {});
  }

  if (App.nativo && App.nativo.hay) setTimeout(refrescar, 0);

  return { pintar: pintar, refrescar: refrescar, nota: nota };
})();
