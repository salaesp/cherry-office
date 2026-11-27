/* Micrófono flotante de la secretaría (docs/plan-recados.md, U4; boceto en bocetos/secretaria/bandeja-y-microfono.html).
   Un botón abajo a la derecha, con su cara y «Hablale a <nombre> · Secretaría»: siempre le habla a quien atiende la
   secretaría, aunque haya otra charla abierta. Grabás, se transcribe en la compu y sale como mensaje en una charla nueva con
   ella; cuando lo entiende (responde), la app abre esa charla para seguir desde ahí. Sin secretaría, ofrece contratarla.
   En el celular se achica a la cara sobre el micrófono y se esconde con un panel abierto (para no tapar el campo de escribir). */
window.App = window.App || {};
App.Microfono = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var raiz = null, estado = 'reposo', firma = '', grab = null, franja = null, tostada = null;

  function secretaria() {
    var sec = App.E && App.E.oficina && App.E.oficina.secretaria;
    return sec && sec.agente && App.agente ? App.agente(sec.agente) : null;
  }
  function cara(a) { return a ? App.retratoImg(a, 'mic-sec-cara', 64) : h('span.mic-sec-cara', { style: { display: 'grid', placeItems: 'center', color: 'var(--suave)' } }, '?'); }

  function montar(app) {
    if (raiz && raiz.isConnected) raiz.remove();
    raiz = h('div.mic-sec');
    app.appendChild(raiz);
    firma = '';
    pintar();
    if (App.on && !montar.escuchando) {
      montar.escuchando = true;
      App.on('actividad', function () { if (estado === 'reposo') pintar(); });
    }
  }

  function pintar(forzar) {
    if (!raiz) return;
    var a = secretaria();
    var f = estado + '|' + (a ? a.id + ':' + a.nombre + ':' + JSON.stringify(a.avatar || '') : '-') + '|' + !!tostada;
    if (!forzar && f === firma) return;
    firma = f;
    App.vaciar(raiz);
    if (tostada) raiz.appendChild(tostada);
    if (estado === 'grabando' && franja) { raiz.appendChild(h('div.mic-sec-grabando', cara(a), franja.el)); return; }
    if (!App.Grabadora.puede()) return;
    if (!a && App.movil) return;   // contratarla es cosa de la compu
    if (!a) {
      raiz.appendChild(h('button.mic-sec-boton', { title: 'Contratá una secretaría para dejarle audios', onclick: function () { App.Ajustes.abrir('secretaria'); } },
        cara(null), h('span.mic-sec-txt', h('b', 'Contratá una secretaría'), h('small', 'para dejarle audios')), h('span.mic-sec-ico.apagado', App.icono('mas'))));
      return;
    }
    raiz.appendChild(h('button.mic-sec-boton', { title: 'Hablale a ' + a.nombre + ' (secretaría)', 'aria-label': 'Hablale a ' + a.nombre + ', secretaría', onclick: grabar },
      cara(a), h('span.mic-sec-txt', h('b', 'Hablale a ' + a.nombre), h('small', 'Secretaría')), h('span.mic-sec-ico', App.Grabadora.icono())));
  }

  function grabar() {
    var a = secretaria();
    if (!a) { App.Ajustes.abrir('secretaria'); return; }
    if (estado !== 'reposo') return;
    grab = App.Grabadora.crear({ alTiempo: function (s) { if (franja) franja.tiempo(s); }, alTope: terminar });
    franja = App.Grabadora.franja({ para: 'Para ' + a.nombre + ' · secretaría', alCancelar: cancelar, alMandar: terminar });
    grab.empezar().then(function () { estado = 'grabando'; pintar(true); }).catch(function (e) { grab = null; franja = null; App.aviso(e.message, true); });
  }
  function cancelar() {
    if (grab) grab.cancelar();
    grab = null; franja = null; estado = 'reposo'; pintar(true);
  }
  function terminar() {
    if (!grab) return;
    var a = secretaria(), wav = grab.terminar();
    grab = null;
    if (!wav || !a) { franja = null; estado = 'reposo'; pintar(true); if (!wav) App.aviso('El audio quedó vacío.', true); return; }
    franja.transcribiendo();
    App.Grabadora.transcribir(wav).then(function (texto) {
      franja = null; estado = 'reposo';
      var sid = App.Agente.hablarNueva(a.id, App.Grabadora.MARCA + texto, function (s) {
        avisar(null);
        App.Agente.abrirSesion(a.id, s);
      });
      avisar(h('div.mic-sec-tostada', { role: 'status' }, cara(a), h('span', 'Le llegó a ' + a.nombre),
        h('button', { onclick: function () { avisar(null); App.Agente.abrirSesion(a.id, sid); } }, 'Ver la charla')));
    }).catch(function (e) { franja = null; estado = 'reposo'; pintar(true); App.aviso(e.message, true); });
  }
  function avisar(el) { tostada = el; pintar(true); }

  return { montar: montar, grabar: grabar, repintar: function () { pintar(true); } };
})();
