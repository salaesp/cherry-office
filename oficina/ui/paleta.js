/* Paleta ⌘K / Ctrl+K: buscar agentes, salas, acciones y reuniones recientes, agrupado por tipo y sin duplicados; sin texto muestra
   lo pendiente y lo reciente; con texto termina con «Buscar … en Conocimiento / Biblioteca». Enter abre (y la cámara va hasta ahí).
   También la barra de pistas: dice qué podés hacer con lo que está bajo el mouse en la maqueta. */
window.App = window.App || {};
App.Paleta = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var velo = null, items = [], filtrados = [], sel = 0, reuniones = [];

  function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  /* coincidencia difusa: todas las letras de la búsqueda en orden; puntaje mejor si son contiguas o al inicio de palabra */
  function puntaje(q, txt) {
    if (!q) return 1;
    var t = norm(txt), i = 0, p = 0, prev = -2, s = 0;
    for (; i < q.length; i++) {
      var k = t.indexOf(q[i], p);
      if (k < 0) return 0;
      s += k === prev + 1 ? 3 : (k === 0 || t[k - 1] === ' ') ? 2 : 1;
      prev = k; p = k + 1;
    }
    return s / (t.length + 1) + s;
  }

  /* orden de los grupos de resultados */
  var GRUPOS = ['Para revisar', 'Recientes', 'Equipo', 'Lugares', 'Acciones', 'Buscar en'];

  function armar() {
    var o = App.E.oficina || { agentes: [], departamentos: [] }, act = App.E.actividad || {}, out = [];
    var sinRev = App.Entregables && App.Entregables.sinRevisar ? App.Entregables.sinRevisar() : 0;
    var permisos = App.Permisos && App.Permisos.cuantos ? App.Permisos.cuantos() : 0;
    function ag(grupo, tipo, icono, txt, sub, buscar, hacer, extra) { out.push(Object.assign({ grupo: grupo, tipo: tipo, icono: icono, txt: txt, sub: sub || '', buscar: buscar, hacer: hacer }, extra || {})); }

    ag('Para revisar', 'Bandeja', 'bandeja', 'Para revisar', sinRev ? sinRev + ' sin revisar' : 'Entregas de los agentes',
      'bandeja entregables entregas revisar despacho direccion', function () { App.Nav.ir('#/bandeja/revisar'); }, { pendiente: sinRev });
    ag('Para revisar', 'Bandeja', 'escudo', 'Te piden permiso', permisos ? permisos + (permisos === 1 ? ' pendiente' : ' pendientes') : 'Nada pendiente',
      'permisos pedidos pendientes bandeja', function () { App.Nav.ir('#/bandeja/permisos'); }, { pendiente: permisos });
    ag('Para revisar', 'Bandeja', 'parte', 'Hoy: lo que te espera', '', 'hoy espera avisos parte', function () { App.Nav.ir('#/bandeja/hoy'); });

    /* un solo lugar por agente: su charla (la ficha se abre desde ahí o desde Equipo) */
    o.agentes.forEach(function (a) {
      var t = act[a.id], d = App.depto(a.departamento);
      ag('Equipo', 'Charla', 'charla', a.nombre, (t ? (t.tarea || t.estado) : a.rol + (d ? ' · ' + d.nombre : '')) + ' · charla · ficha en Equipo',
        a.nombre + ' ' + a.rol + ' ' + (d ? d.nombre : '') + ' ficha perfil editar charla hablar',
        function () { App.Oficina.enfocarAgente(a.id); App.Agente.abrir(a.id); }, { activo: !!t });
    });
    o.departamentos.forEach(function (d) {
      ag('Equipo', 'Departamento', 'capas', d.nombre, 'departamento', 'departamento departamentos ' + d.nombre, function () { App.Nav.ir('#/equipo/departamentos'); });
    });
    if (!o.departamentos.length) ag('Equipo', 'Departamento', 'capas', 'Departamentos', '', 'departamentos', function () { App.Nav.ir('#/equipo/departamentos'); });
    ag('Equipo', 'Vos', 'personas', 'Tu perfil', App.Yo.nombre(), 'yo perfil quien dirige mi nombre dueño apariencia', function () { App.Yo.abrir(); });

    ag('Lugares', 'Sala', 'reunion', 'Sala de reuniones', '', 'sala reuniones', function () { App.Oficina.enfocarLugar('reunion'); App.Reunion.abrir(); });
    ag('Lugares', 'Sala', 'libro', 'Biblioteca', 'Documentos y fichas', 'biblioteca archivos documentos', function () { App.Nav.ir('#/archivos/biblioteca'); });
    ag('Lugares', 'Archivos', 'carpeta', 'Carpeta de la oficina', '', 'carpeta oficina archivos', function () { App.Nav.ir('#/archivos/carpeta'); });
    ag('Lugares', 'Archivos', 'bombilla', 'Conocimiento de la oficina', 'Lo que ya se sabe', 'conocimiento preguntas frecuentes sabe', function () { App.Nav.ir('#/archivos/conocimiento'); });

    [['Flujos', 'flujo', 'Correr, editar o armar uno nuevo', 'flujos flujo corrida nueva correr editar', function () { App.Flujos.abrir(); }],
     ['Tareas programadas y pendientes', 'reloj', '', 'tareas programadas pendientes', function () { App.Tareas.abrir(); }],
     ['Armar con el Creador', 'chispa', 'Armá la oficina charlando', 'creador armar oficina', function () { App.Nav.ir('#/equipo/creador'); }],
     ['Contratar un agente', 'mas', '', 'contratar agente nuevo', function () { App.Nav.ir('#/equipo/contratar'); }],
     ['Llamar a reunión', 'reunion', '', 'llamar reunion', function () { App.Reunion.nueva(); }],
     ['Nuevo departamento', 'capas', '', 'nuevo departamento', function () { App.Departamentos.agregar(); }],
     ['Ajustes', 'ajustes', '', 'ajustes configuracion', function () { App.Ajustes.abrir(); }],
     ['Nombre de la oficina y quién dirige', 'edificio', '', 'nombre oficina dirige general', function () { App.Ajustes.abrir('general'); }],
     ['Reglas de la oficina', 'regla', '', 'reglas oficina', function () { App.Ajustes.abrir('reglas'); }],
     ['Conectores', 'enchufe', '', 'conectores', function () { App.Ajustes.abrir('conectores'); }],
     ['Permisos de los agentes', 'escudo', '', 'permisos agentes', function () { App.Ajustes.abrir('permisos'); }],
     ['Siguiente aviso pendiente', 'chispa', '', 'siguiente aviso pendiente', function () { if (App.Avisos) App.Avisos.siguiente(); }],
     ['Revisar la próxima entrega', 'chispa', '', 'revisar proxima entrega', function () { if (!App.Entregables.siguiente()) App.aviso('No tenés entregas sin revisar.'); }],
     ['Exportar oficina', 'subir', '', 'exportar oficina', function () { App.exportarOficina(); }],
     ['Ver toda la oficina', 'edificio', '', 'ver toda encuadrar oficina', function () { App.Oficina.encuadrar(); }]].forEach(function (x) {
      ag('Acciones', 'Acción', x[1], x[0], x[2], x[0] + ' ' + x[3], x[4]);
    });
    App.opcionesOficina().forEach(function (op) { ag('Acciones', 'Acción', op.icono, op.texto, '', op.texto, op.accion); });
    reuniones.slice(0, 8).forEach(function (r) {
      ag('Recientes', 'Reunión', 'reunion', r.titulo || r.tema, App.fecha ? App.fecha(r.creada) : '', 'reunion ' + (r.titulo || r.tema) + ' ' + (r.tema || ''),
        function () { App.Reunion.ver ? App.Reunion.ver(r.id) : App.Reunion.abrir(); });
    });
    return out;
  }

  /* qué se muestra sin texto: primero lo pendiente, después lo reciente y un par de atajos */
  function inicio(items) {
    var pend = items.filter(function (x) { return x.grupo === 'Para revisar'; })
      .sort(function (a, b) { return (b.pendiente || 0) - (a.pendiente || 0); });
    var hay = pend.filter(function (x) { return x.pendiente; });
    var rec = items.filter(function (x) { return x.grupo === 'Recientes'; }).slice(0, 3);
    var gente = items.filter(function (x) { return x.tipo === 'Charla'; }).sort(function (a, b) { return (b.activo ? 1 : 0) - (a.activo ? 1 : 0); }).slice(0, 4);
    var acc = items.filter(function (x) { return ['Flujos', 'Armar con el Creador', 'Llamar a reunión', 'Ajustes'].indexOf(x.txt) >= 0; });
    return (hay.length ? hay : pend.slice(0, 1)).concat(rec, gente, acc);
  }

  function abrir() {
    if (velo || document.querySelector('.cmdk-velo')) return;
    if (!App.E.oficina) return;
    items = armar();
    var inp = h('input.cmdk-buscar', { placeholder: 'Buscar agentes, salas, acciones…', autocomplete: 'off', spellcheck: false });
    var lista = h('div.cmdk-lista');
    var caja = h('div.cmdk', { onclick: function (e) { e.stopPropagation(); } }, h('div.cmdk-cab', App.icono('buscar'), inp), lista,
      h('div.cmdk-pie', h('span', h('kbd', '↑'), h('kbd', '↓'), ' elegir'), h('span', h('kbd', '↵'), ' abrir'), h('span', h('kbd', 'esc'), ' cerrar')));
    velo = h('div.velo.cmdk-velo', { onclick: cerrar }, caja);
    document.body.appendChild(velo);
    function filtrar() {
      var texto = inp.value.trim(), q = norm(texto);
      if (!q) filtrados = inicio(items);
      else {
        var res = items.map(function (x) { return { x: x, s: puntaje(q.replace(/\s+/g, ''), x.buscar) }; })
          .filter(function (y) { return y.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 12).map(function (y) { return y.x; });
        /* agrupados por tipo, en el orden de los grupos (dentro de cada uno, el mejor puntaje primero) */
        filtrados = [];
        GRUPOS.forEach(function (g) { res.forEach(function (x) { if (x.grupo === g) filtrados.push(x); }); });
        var corto = texto.length > 28 ? texto.slice(0, 27) + '…' : texto;
        filtrados.push({ grupo: 'Buscar en', tipo: 'Buscar', icono: 'bombilla', txt: 'Buscar «' + corto + '» en Conocimiento', sub: 'Decisiones, notas, actas y respuestas de los agentes',
          hacer: function () { if (App.Conocimiento) App.Conocimiento.busquedaPendiente = texto; App.Nav.ir('#/archivos/conocimiento'); } });
        filtrados.push({ grupo: 'Buscar en', tipo: 'Buscar', icono: 'libro', txt: 'Buscar «' + corto + '» en Biblioteca', sub: 'Los documentos y sus fichas',
          hacer: function () { if (App.Biblioteca) App.Biblioteca.busquedaPendiente = texto; App.Nav.ir('#/archivos/biblioteca'); } });
      }
      sel = 0; pintar();
    }
    function pintar() {
      App.vaciar(lista);
      var previo = null;
      filtrados.forEach(function (x, i) {
        if (x.grupo !== previo) { previo = x.grupo; lista.appendChild(h('div.cmdk-grupo', !inp.value.trim() && x.grupo === 'Para revisar' ? 'Para revisar' : x.grupo)); }
        var fila = h('div.cmdk-item' + (i === sel ? '.sel' : ''), { onmousemove: function () { if (sel !== i) { sel = i; pintar(); } }, onclick: function () { elegir(i); } },
          App.icono(x.icono), h('div.cmdk-txt', h('b', x.txt), x.sub ? h('small', x.sub) : null), x.pendiente ? h('span.insignia.aviso', String(x.pendiente)) : h('span.cmdk-tipo', x.tipo));
        lista.appendChild(fila);
      });
      var s = lista.querySelector('.sel'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' });
    }
    inp.addEventListener('input', filtrar);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { sel = Math.min(filtrados.length - 1, sel + 1); pintar(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); pintar(); e.preventDefault(); }
      else if (e.key === 'Enter') { elegir(sel); e.preventDefault(); }
      else if (e.key === 'Escape') { cerrar(); e.preventDefault(); e.stopPropagation(); }
    });
    filtrar();
    setTimeout(function () { inp.focus(); }, 0);
    App.api.get('/api/reuniones').then(function (r) { reuniones = r.reuniones || []; if (velo) { items = armar(); filtrar(); } }).catch(function () {});
  }
  function elegir(i) { var x = filtrados[i]; if (!x) return; cerrar(); x.hacer(); }
  function cerrar() {
    document.querySelectorAll('.cmdk-velo').forEach(function (v) { v.remove(); });   /* por si quedó alguna copia */
    velo = null;
  }

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (velo) cerrar(); else if (!(App.hojaAbierta && App.hojaAbierta())) abrir();
    }
  });

  /* ---------------- barra de pistas ---------------- */
  var esMac = /Mac/.test(navigator.platform || navigator.userAgent);
  function base() {
    return 'Rueda o pellizco para acercarte · arrastrá para moverte · ' +
      (esMac ? '⌘K' : 'Ctrl+K') + ' buscar · N siguiente aviso';
  }
  var VERBO = { pensando: 'pensando', leyendo: 'leyendo', escribiendo: 'escribiendo', buscando: 'buscando', consultando: 'consultando a', trabajando: 'trabajando' };
  function pista(hov) {
    var el = App.dom && App.dom.lienzo && App.dom.lienzo.parentNode && App.dom.lienzo.parentNode.querySelector('.pista');
    if (!el) return;
    if (!hov) { el.textContent = base(); el.classList.remove('viva'); return; }
    var t;
    if (hov.tipo === 'agente') {
      var a = App.agente(hov.id), act = (App.E.actividad || {})[hov.id];
      t = 'Clic: hablar con ' + (a ? a.nombre : hov.id);
      if (act) t += ' · ' + (VERBO[act.estado] || act.estado) + (act.objetivo ? ' ' + act.objetivo : '');
    } else if (hov.tipo === 'reunion') t = 'Clic: abrir la sala de reuniones';
    else if (hov.tipo === 'biblioteca') t = hov.id === 'bibliotecario' ? 'El bibliotecario cuida la memoria de la oficina · clic: abrir la biblioteca' : 'Clic: abrir la biblioteca';
    else if (hov.tipo === 'direccion') t = 'Clic: lo que te espera para revisar';
    else if (hov.tipo === 'yo') t = 'Sos vos' + (App.Yo.nombre() ? ', ' + App.Yo.nombre() : '') + ' · clic: cambiar tu nombre o ' + 'tu apariencia';
    else if (hov.tipo === 'creador') t = 'Clic: armar o cambiar la oficina con el Creador';
    else if (hov.tipo === 'juegos') t = 'Juegos y café: acá descansan los agentes sin trabajo';
    else if (hov.texto) t = hov.texto;   // bandeja de entregables: la oficina ya arma el texto
    el.textContent = t || base();
    el.classList.toggle('viva', !!t);
  }

  return { abrir: abrir, cerrar: cerrar, pista: pista, get BASE() { return base(); } };
})();
