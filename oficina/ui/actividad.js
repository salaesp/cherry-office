/* Actividad en vivo: sondea /api/actividad (cada 1 s si alguien trabaja, cada 4 s si no) y la reparte a la oficina
   (pose, pantalla y cartel de tarea) y a la barra lateral (rol -> qué está haciendo). */
window.App = window.App || {};
App.Actividad = (function () {
  'use strict';
  var timer = null, version = -1, errores = 0, datos = { agentes: {} };
  var VERBO = { pensando: 'Pensando', leyendo: 'Leyendo', escribiendo: 'Escribiendo', buscando: 'Buscando',
    consultando: 'Consultando a', trabajando: 'Trabajando' };

  function ciclo() {
    clearTimeout(timer);
    App.api.get('/api/actividad').then(function (r) {
      errores = 0;
      if (r.version !== version) { version = r.version; aplicar(r); }
    }).catch(function () { errores++; }).then(function () {
      var hay = Object.keys(datos.agentes || {}).length > 0 || Object.keys(App.E.ocupados || {}).length > 0;
      timer = setTimeout(ciclo, errores ? 5000 : hay ? 1000 : 4000);
    });
  }

  function aplicar(r) {
    datos = r;
    App.E.actividad = r.agentes || {};
    if (App.Oficina) App.Oficina.actividad(App.E.actividad);
    pintarLateral();
    if (App.marcarEstados) App.marcarEstados();
    if (App.emit) App.emit('actividad', r);
  }

  /* en la fila del equipo, el rol se reemplaza por lo que está haciendo */
  function pintarLateral() {
    var eq = App.dom && App.dom.equipo; if (!eq) return;
    eq.querySelectorAll('.persona[data-id]').forEach(function (el) {
      var id = el.getAttribute('data-id'), rol = el.querySelector('.persona-rol'), a = App.agente(id), t = (App.E.actividad || {})[id];
      if (!rol || !a) return;
      rol.textContent = t ? (VERBO[t.estado] || 'Trabajando') + (t.objetivo ? ' ' + t.objetivo : '…') : a.rol;
      rol.classList.toggle('vivo', !!t);
    });
  }

  return {
    iniciar: function () { if (!timer) ciclo(); },
    ya: function () { ciclo(); },                     // pedir ya (p. ej. al mandar un mensaje)
    repintar: pintarLateral,
    datos: function () { return datos; }
  };
})();
