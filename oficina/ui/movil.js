/* Modo celular (docs/plan-celular.md, fase 2): la misma app con menos cosas, para la oficina instalada en el teléfono.
   Se prende con `?movil=1` (lo pone el start_url del manifest), al abrirla instalada (display-mode: standalone) o en una
   pantalla táctil angosta; `?movil=0` lo apaga. Queda recordado en la pestaña (sessionStorage). Nunca en la app de escritorio.
   Con el modo prendido:
   - <html class="modo-movil">: el CSS esconde lo que es de la compu (.solo-compu y otros, en estilo.css);
   - la oficina pixel no se arma: App.Oficina pasa a ser un reemplazo que no hace nada (ahorra CPU y batería);
   - nav.js arma la barra Bandeja · Charlas · Trabajo · Más y redirige las pantallas de la compu a la Bandeja.
   Se carga después de base.js y de la oficina pixel, y antes de los módulos que la usan. */
window.App = window.App || {};
App.movil = (function () {
  'use strict';
  if (App.nativo && App.nativo.hay) return false;
  var q = (location.search.match(/[?&]movil=([01])/) || [])[1], guardado = null;
  try {
    if (q) sessionStorage.setItem('oficina.movil', q);
    guardado = sessionStorage.getItem('oficina.movil');
  } catch (e) {}
  if (q === '0' || (!q && guardado === '0')) return false;
  if (q === '1' || guardado === '1') return true;
  var mm = function (c) { return !!(window.matchMedia && window.matchMedia(c).matches); };
  return mm('(display-mode: standalone)') || navigator.standalone === true || (mm('(pointer: coarse)') && mm('(max-width: 720px)'));
})();

if (App.movil) {
  document.documentElement.classList.add('modo-movil');
  /* La oficina pixel no se arma en el celular. Todos los que la usan pasan por estas funciones. */
  (function () {
    var nada = function () {};
    App.Oficina = {
      movil: true, pixel: false,
      iniciar: nada, construir: function () { return Promise.resolve(); },
      alElegirAgente: nada, alElegirLugar: nada, alPasar: nada,
      elegir: nada, ocupado: nada, reunion: nada, finReunion: nada, encuadrar: nada, actividad: nada, faros: nada,
      enfocar: nada, enfocarAgente: nada, margen: nada, marcar: nada, enfocarLugar: nada, muro: nada, pieza: nada,
      pedir: nada, pausar: nada, bibliotecario: nada
    };
  })();
}
