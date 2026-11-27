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
      if (hay) pintarLateral();   // el «cuánto lleva» avanza aunque no cambie nada más
      timer = setTimeout(ciclo, errores ? 5000 : hay ? 1000 : 4000);
    });
  }

  function aplicar(r) {
    datos = r;
    App.E.actividad = r.agentes || {};
    anotarDesde(App.E.actividad);
    if (App.Oficina) App.Oficina.actividad(App.E.actividad);
    pintarLateral();
    if (App.marcarEstados) App.marcarEstados();
    if (App.emit) App.emit('actividad', r);
  }

  /* desde cuándo trabaja cada agente, en el reloj local (el backend manda `seg` y solo avisa cuando algo cambia) */
  var desde = {};
  function anotarDesde(ags) {
    var ahora = Date.now(), nuevo = {};
    Object.keys(ags).forEach(function (id) {
      var t = ags[id], clave = (t.origen || '') + '\u001f' + (t.tarea || '');
      var prev = desde[id];
      nuevo[id] = prev && prev.clave === clave ? prev : { clave: clave, ms: ahora - (t.seg || 0) * 1000 };
    });
    desde = nuevo;
  }
  function cuanto(id) {
    var d = desde[id]; if (!d) return '';
    var s = Math.max(0, Math.floor((Date.now() - d.ms) / 1000));
    return s < 60 ? s + ' s' : s < 3600 ? Math.floor(s / 60) + ' min' : Math.floor(s / 3600) + ' h';
  }

  /* De dónde viene el trabajo: ícono y texto del primer renglón. `tarea` ya trae el texto armado por el backend
     («Respondiéndote», «Consulta de Ana», «Reunión: …», el nombre de la tarea…). */
  function origenDe(t) {
    var tarea = t.tarea || '';
    switch (t.origen) {
      case 'chat': return { icono: 'charla', texto: 'Charla con vos' };
      case 'consulta': return { icono: 'bombilla', texto: tarea || 'Consulta' };
      case 'reunion': return { icono: 'personas', texto: tarea ? tarea.replace(/^Reunión: /, 'Reunión · ') : 'Reunión' };
      case 'biblioteca': return { icono: 'libro', texto: 'Biblioteca' + (tarea ? ' · ' + tarea.replace(/^Leyendo /, '') : '') };
      case 'creador': return { icono: 'chispa', texto: tarea || 'Armando la oficina' };
      case 'flujo': return { icono: 'flujo', texto: 'Flujo' + (tarea ? ' · ' + tarea : '') };
      case 'parte': return { icono: 'parte', texto: 'Parte del día' };
      case 'encargo': return { icono: 'bandeja', texto: 'Encargo' + (tarea ? ' · ' + tarea : '') };
      case 'tarea': return { icono: 'hora', texto: 'Tarea' + (tarea ? ' · ' + tarea : '') };
      default: return { icono: 'hora', texto: tarea || 'Trabajando' };
    }
  }

  /* En la fila del equipo, mientras trabaja: un renglón con de dónde viene (ícono) y otro con el paso y cuánto lleva.
     Recién mandado un mensaje, antes de que llegue la actividad, ya dice «Respondiéndote…». */
  function pintarLateral() {
    var eq = App.dom && App.dom.equipo; if (!eq) return;
    eq.querySelectorAll('.persona[data-id]').forEach(function (el) {
      var id = el.getAttribute('data-id'), txt = el.querySelector('.persona-txt'), rol = el.querySelector('.persona-rol'), a = App.agente(id);
      if (!txt || !rol || !a) return;
      var t = (App.E.actividad || {})[id], esperando = !t && !!(App.E.ocupados || {})[id];
      var org = txt.querySelector('.persona-origen');
      if (!t && !esperando) {
        if (org) org.remove();
        rol.textContent = a.rol; rol.className = 'persona-rol'; el.removeAttribute('title');
        return;
      }
      var o = t ? origenDe(t) : { icono: 'charla', texto: 'Charla con vos' };
      if (!org) { org = App.h('div.persona-origen'); txt.insertBefore(org, rol); }
      if (org.dataset.clave !== o.icono + o.texto) {
        org.dataset.clave = o.icono + o.texto;
        org.textContent = ''; org.appendChild(App.icono(o.icono)); org.appendChild(App.h('span', o.texto));
      }
      var paso = t ? (VERBO[t.estado] || 'Trabajando') + (t.objetivo ? ' ' + t.objetivo : '…') : 'Respondiéndote…';
      var seg = t ? cuanto(id) : '';
      rol.className = 'persona-rol persona-paso' + (t ? '' : ' esperando');
      rol.textContent = '';
      rol.appendChild(App.h('span.paso-txt', paso));
      if (seg) rol.appendChild(App.h('span.paso-seg', seg));
      el.title = o.texto + ' · ' + paso + (seg ? ' · hace ' + seg : '');
    });
  }

  return {
    iniciar: function () { if (!timer) ciclo(); },
    ya: function () { ciclo(); },                     // pedir ya (p. ej. al mandar un mensaje)
    repintar: pintarLateral,
    datos: function () { return datos; }
  };
})();
