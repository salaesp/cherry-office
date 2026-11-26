/* Panel del agente: su charla y, en la compu, una columna al costado («lado»): sus detalles (charlas, tareas, archivos y
   notas, con «Ver todas») o, desde el lápiz, su ficha (perfil y apariencia, permisos). En el celular esa misma columna se
   abre a pantalla completa encima de la charla con el botón «Detalles»; la ficha con pestañas sale tocando la cara. */
(function () {
  'use strict';
  var h = App.h, api = App.api;
  var actual = null, pestana = 'chat';
  var PESTANAS = ['perfil', 'permisos', 'notas', 'tareas', 'archivos'];
  var lado = 'detalles', ladoFiltro = '';   // la columna al costado de la charla (compu)
  var ladoMovil = false;   // celular: la columna de detalles abierta encima de la charla
  /* un archivo abierto al costado de la charla, en vez de en una hoja flotante: {caja, obj}. Si entra va como tercera
     columna (charla · detalles · archivo); si no, ocupa el lugar de la columna de detalles */
  var visor = null;
  var VISOR_MIN = 680, OFICINA_MIN = 360;   // ancho mínimo del archivo y franja de oficina que tiene que quedar a la vista
  function attrLado() { return lado === 'detalles' ? 'detalles' : 'ancho'; }
  function pxVar(nombre, def) { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(nombre)) || def; }
  function visorJunto() {
    var charla = pxVar('--charla', 440), det = lado === 'detalles' ? 290 : 400;
    var riel = App.dom.riel ? App.dom.riel.offsetWidth : 68, lista = pxVar('--lista', 284);
    return window.innerWidth - riel - lista - (charla + det + VISOR_MIN) >= OFICINA_MIN;
  }
  function esCompu() { return !window.matchMedia('(max-width: 720px)').matches; }
  /* ¿se está mostrando esa parte de la ficha? (como pantalla en el celular, o en la columna del costado en la compu) */
  function viendo(p) { return pestana === p || (pestana === 'chat' && lado === p && (esCompu() || ladoMovil)); }
  var sesionFija = null;  // la charla que se abrió por su id (desde la lista de charlas): va en la ruta #/charlas/<agente>/<sesión>
  var sesiones = {};      // id -> session uuid
  var chats = {};         // id -> [{r, t, e}]  (cache en memoria)
  var enCurso = {};       // id -> true mientras espera respuesta
  var colas = {};         // id -> [{t, nombres, archivos, eleccion, sesion, guardar}]: mensajes que esperan a que el agente termine
  var pausadas = {};      // id -> true: la cola no sigue sola (lo anterior se cortó o falló) hasta que la persona diga «Seguir»
  var cancelando = {};    // id -> true entre «Detener» y que el agente pare
  var repintarChat = null;    // {id, fn}: repinta la charla abierta (mensajes, cola y botones) sin rearmar el panel
  /* modelo y esfuerzo elegidos en cada charla (por sesión; se recuerdan en este navegador). Sin elegir: los del agente */
  var CLAVE_ELECCION = 'oficina.charla.eleccion';
  function elecciones() { try { return JSON.parse(localStorage.getItem(CLAVE_ELECCION) || '{}') || {}; } catch (e) { return {}; } }
  function eleccionDe(clave) { return elecciones()[clave] || {}; }
  function guardarEleccion(clave, v) {
    var todas = elecciones();
    if (v && Object.keys(v).length) todas[clave] = v; else delete todas[clave];
    var ks = Object.keys(todas); if (ks.length > 200) ks.slice(0, ks.length - 200).forEach(function (k) { delete todas[k]; });
    try { localStorage.setItem(CLAVE_ELECCION, JSON.stringify(todas)); } catch (e) { /* no se recuerda */ }
  }
  var borradores = {};    // id -> texto a medio escribir en el chat (sobrevive al cambiar de pestaña o de agente)
  var vivos = {};         // id -> pasos de la respuesta que se está escribiendo (/api/chat/vivo)
  var refrescarVivo = null;   // {id, fn}: repinta la burbuja en vivo del chat abierto

  /* Mientras el agente responde, cada ~0,7 s trae lo que va escribiendo y haciendo (textos y herramientas), como Claude Code. */
  function seguirVivo(id) {
    var version = -1;
    function paso() {
      if (!enCurso[id]) return;
      api.get('/api/chat/vivo', { agent: id }).then(function (r) {
        if (!enCurso[id] || !r.activo || r.version === version) return;
        version = r.version;
        vivos[id] = r.pasos || [];
        if (refrescarVivo && refrescarVivo.id === id && actual === id && pestana === 'chat') refrescarVivo.fn();
      }).catch(function () {}).then(function () { if (enCurso[id]) setTimeout(paso, 700); });
    }
    setTimeout(paso, 300);
  }

  /* ---- enviar, cola y «Detener» ---- */
  function repintar(id) { if (repintarChat && repintarChat.id === id && actual === id && pestana === 'chat') repintarChat.fn(); }

  /* Manda un mensaje ya leído (con sus archivos) y, al terminar, sigue con el primero de la cola. Vive afuera de la charla
     pintada: la cola sigue andando aunque la persona cambie de pestaña o de agente. */
  function enviarMensaje(id, m) {
    if (!App.agente(id)) return;
    ocupado(id, true);
    delete vivos[id]; delete cancelando[id]; delete pausadas[id];
    seguirVivo(id);
    (chats[id] = chats[id] || []).push({ r: 'u', t: m.t, adj: m.nombres });
    repintar(id);
    if (App.Actividad) setTimeout(App.Actividad.ya, 300);
    var cuerpo = Object.assign({ agent: id, message: m.t, session: m.sesion }, m.eleccion);
    if (m.archivos.length) cuerpo.archivos = m.archivos;
    api.post('/api/chat', cuerpo).then(function (r) {
      if (App.Actividad) App.Actividad.ya();
      (chats[id] = chats[id] || []).push({ r: 'a', t: r.reply || '(sin respuesta)', pasos: r.pasos });
      if (r.cancelado) pausadas[id] = true;   // lo cortó la persona: lo que sigue en la cola espera su OK
      if (r.contexto && sesiones[id] === m.sesion) App.ChipContexto.fijar(id, r.contexto);
      if (m.guardar) m.guardar(m.archivos);
    }).catch(function (e) {
      pausadas[id] = true;                    // falló: no mandarle más cosas encima sin que la persona lo vea
      (chats[id] = chats[id] || []).push({ r: 'a', t: 'No pude responder: ' + e.message, e: true });
    }).then(function () { return cargarConsultas(id); }).then(function () {
      delete vivos[id]; delete cancelando[id];
      ocupado(id, false);
      if (actual === id && pestana === 'chat') pintar();   // si no, el aviso llega por /api/actividad (banner y faro)
      if (App.Nav) App.Nav.refrescar();                    // la lista de charlas: título, último mensaje y orden
      seguirCola(id);
    });
  }

  /* manda el primero de la cola, si el agente está libre y la cola no está en pausa */
  function seguirCola(id) {
    var cola = colas[id];
    if (!cola || !cola.length || enCurso[id] || pausadas[id]) return;
    var m = cola.shift();
    if (!cola.length) delete colas[id];
    enviarMensaje(id, m);
  }

  /* la cola es de la charla abierta: al cambiar de charla (nueva o una guardada) se descarta */
  function soltarCola(id) { delete colas[id]; delete pausadas[id]; }

  /* «Detener»: corta lo que el agente está haciendo; la cola queda en pausa hasta que la persona la reanude */
  function detener(id) {
    if (!enCurso[id] || cancelando[id]) return;
    cancelando[id] = true; pausadas[id] = true;
    repintar(id);
    api.post('/api/chat/cancelar', { agent: id }).catch(function (e) {
      // 409: ya había terminado. Nada se cortó, así que la cola sigue como si nada.
      delete cancelando[id]; delete pausadas[id];
      if (e.status !== 409) App.fallo(e);
      repintar(id);
      seguirCola(id);
    });
  }

  /* los mensajes en cola, como burbujas pendientes debajo de la charla, cada uno con su «Sacar» */
  function bloqueCola(a) {
    var cola = colas[a.id] || [];
    var nota = pausadas[a.id] ? 'En pausa: lo anterior se cortó o falló' : enCurso[a.id] ? 'Salen solos cuando ' + a.nombre + ' termine' : '';
    return h('div.cola',
      h('div.cola-cab', h('b', cola.length === 1 ? '1 mensaje en cola' : cola.length + ' mensajes en cola'), h('span.cola-nota', nota),
        pausadas[a.id] && !enCurso[a.id] ? h('button.btn.chico.primario', { onclick: function () { delete pausadas[a.id]; seguirCola(a.id); } }, 'Seguir') : null),
      cola.map(function (m, i) {
        return h('div.cola-item',
          h('div.cola-txt', m.t || 'Te paso estos archivos.', m.nombres.length ? h('span.cola-adj', App.icono('clip'), m.nombres.length === 1 ? m.nombres[0] : m.nombres.length + ' archivos') : null),
          h('button.btn.fantasma.chico.icono', { title: 'Sacar de la cola', onclick: function () {
            cola.splice(i, 1); if (!cola.length) delete colas[a.id];
            repintar(a.id);
          } }, App.icono('cerrar')));
      }));
  }

  /* Consultas a colegas (Fase 4): /api/consultas?session= trae lo que el agente consultó en esa conversación; cada una trae
     `pos` = índice, en el historial, de la respuesta del agente que la hizo. Se cuelgan de esa respuesta como `m.consultas`. */
  function cargarConsultas(id) {
    var sid = sesiones[id];
    if (!sid) return Promise.resolve();
    return api.get('/api/consultas', { session: sid }).then(function (r) {
      var msgs = chats[id] || [];
      msgs.forEach(function (m) { delete m.consultas; });
      (r.consultas || []).forEach(function (c) {
        var m = msgs[c.pos];
        if (m && m.r === 'a') (m.consultas = m.consultas || []).push(c);
      });
    }).catch(function () { /* sin consultas: el chat se ve igual */ });
  }

  /* «Consultó a Patricia» plegable, con la pregunta y la respuesta de cada consulta */
  function bloqueConsultas(cs) {
    var nombres = [];
    cs.forEach(function (c) { if (nombres.indexOf(c.aNombre) < 0) nombres.push(c.aNombre); });
    var quien = nombres.length > 1 ? nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1] : nombres[0];
    return h('details.consultas', h('summary', 'Consultó a ' + quien),
      cs.map(function (c) {
        return h('div.consulta', h('div.consulta-p', h('b', c.aNombre), ' · ' + c.pregunta),
          c.error ? h('div.consulta-r.e', c.error) : App.htmlSeguro(h('div.consulta-r'), App.markdown(c.respuesta || '')));
      }));
  }

  function abrir(id, pest) {
    var a = App.agente(id); if (!a) return;
    var mismo = actual === id;
    ladoMovil = false;   // celular: elegir una charla (o volver a abrirla) muestra la charla, no los detalles
    if (!mismo) { sesionFija = null; lado = 'detalles'; ladoFiltro = ''; visor = null; }
    actual = id; pestana = pest || (mismo ? pestana : 'chat');
    /* en la compu la ficha va al costado de la charla */
    if (esCompu() && pestana !== 'chat') { lado = pestana; pestana = 'chat'; }
    App.Oficina3D.elegir(id);
    App.abrirDerecho('agente');   // primero: así ya está en su sección al pintar
    pintar();
    if (esCompu() && App.Oficina3D.enfocarAgente) App.Oficina3D.enfocarAgente(id);
    if (App.Avisos) App.Avisos.vistoAgente(id);
    App.marcarEstados();
  }

  /* Dos caras: la charla (limpia, sin pestañas; en Charlas) y la ficha del agente (en Equipo, con su ruta por pestaña).
     Desde la charla se llega a la ficha de una sola forma: tocando la cara, como en una app de mensajes. */
  var FICHA = [['perfil', 'Perfil y apariencia'], ['permisos', 'Permisos'], ['notas', 'Notas'], ['tareas', 'Tareas'], ['archivos', 'Archivos']];
  /* cambia de cara o de pestaña: primero la sección y la ruta (Charlas o Equipo), después el panel */
  function irPestana(p) {
    if (esCompu() && p !== 'chat') { verLado(lado === p ? 'detalles' : p); return; }
    pestana = p; if (App.Nav) App.Nav.alAbrir('agente'); pintar();
  }
  /* cambia lo que muestra la columna del costado sin rearmar la charla */
  function verLado(cual) {
    lado = cual || 'detalles'; ladoFiltro = '';
    if (!esCompu()) { ladoMovil = true; detallesVistos(); }
    if (visor && !visorJunto()) visor = null;   // el archivo tapaba la columna: se cierra para mostrar lo pedido
    pintarSoloLado();
  }
  /* Un archivo (página, imagen, documento) en la columna del costado, al lado de la charla. Devuelve lo mismo que App.hoja
     ({el, cuerpo, pie, cab, cerrar, titulo}) o null si no hay charla abierta en la compu: entonces va en una hoja. */
  function abrirVisor(op) {
    var der = App.dom.derecho;
    if (!actual || !esCompu() || App.modoDerecho() !== 'agente' || !der.querySelector(':scope > aside.relacionado:not(.lado-visor), :scope > aside.lado-visor')) return null;
    var cuerpo = h('div.hoja-cuerpo'), pie = h('div.hoja-pie'), tit = h('b', { title: op.titulo || '' }, op.titulo || '');
    var cerrada = false;
    function cerrarVisor() {
      if (cerrada) return; cerrada = true;
      if (visor && visor.obj === obj) { visor = null; pintarSoloLado(); }
      if (op.alCerrar) op.alCerrar();
    }
    var cab = h('div.lat-cab', h('button.btn.fantasma.icono', { title: 'Cerrar el archivo', onclick: cerrarVisor }, App.icono('atras')), tit,
      h('button.btn.fantasma.icono.lat-cerrar', { title: 'Cerrar la charla', onclick: App.cerrarVentana }, App.icono('cerrar')));
    var caja = h('aside.relacionado.lado-visor', cab, cuerpo, op.sinPie ? null : pie);
    var obj = { el: caja, cuerpo: cuerpo, pie: pie, cab: cab, cerrar: cerrarVisor, titulo: function (t) { tit.textContent = t; tit.title = t; } };
    visor = { caja: caja, obj: obj };
    pintarSoloLado();
    return obj;
  }
  /* celular: cierra la columna de detalles y vuelve a la charla */
  function cerrarLadoMovil() {
    ladoMovil = false; lado = 'detalles'; ladoFiltro = '';
    var der = App.dom.derecho;
    Array.prototype.forEach.call(der.querySelectorAll(':scope > aside.relacionado'), function (x) { x.remove(); });
    der.classList.remove('lado-movil'); der.removeAttribute('data-lado');
  }
  function pintarSoloLado() {
    var a = App.agente(actual), der = App.dom.derecho;
    if (!a || App.modoDerecho() !== 'agente') return;
    if (esCompu() ? !der.querySelector(':scope > aside.relacionado') : !(ladoMovil && pestana === 'chat')) return;
    ponerColumnas(a);
    if (App.Nav && App.Nav.acomodar) App.Nav.acomodar();   // cambió el ancho: ¿sigue flotando? y la cámara recentra
    var lp = der.querySelector('.agente-lapiz-btn'); if (lp) lp.setAttribute('aria-pressed', String(lado === 'perfil' || lado === 'permisos'));
  }
  /* las columnas al costado de la charla: la de detalles y, si hay un archivo abierto, el visor (al lado o en su lugar) */
  function ponerColumnas(a) {
    var der = App.dom.derecho;
    Array.prototype.forEach.call(der.querySelectorAll(':scope > aside.relacionado'), function (x) { x.remove(); });
    var junto = visor && visorJunto();
    if (!visor || junto) der.appendChild(columnaLado(a));
    if (visor) der.appendChild(visor.caja);
    der.setAttribute('data-lado', attrLado());
    if (visor) der.setAttribute('data-visor', junto ? 'junto' : 'solo'); else der.removeAttribute('data-visor');
    der.classList.toggle('lado-movil', !esCompu());
  }
  /* si cambia el ancho de la ventana, el archivo pasa de al lado a en lugar de los detalles (o al revés) */
  window.addEventListener('resize', function () {
    if (!visor || !actual || App.modoDerecho() !== 'agente') return;
    var esta = App.dom.derecho.getAttribute('data-visor');
    if (esta && esta !== (visorJunto() ? 'junto' : 'solo')) pintarSoloLado();
  });
  /* la columna del costado: detalles, la ficha (perfil o permisos) o la lista completa de algo */
  function columnaLado(a) {
    var caja = h('aside.relacionado');
    /* cada cabecera de la columna termina con la cruz: así queda arriba a la derecha de todo el panel */
    var latCab = function () {
      var c = App.add(h('div.lat-cab'), Array.prototype.slice.call(arguments));
      c.appendChild(esCompu() ? h('button.btn.fantasma.icono.lat-cerrar', { title: 'Cerrar la charla', onclick: App.cerrarVentana }, App.icono('cerrar'))
        : h('button.btn.fantasma.icono.lat-cerrar', { title: 'Volver a la charla', onclick: cerrarLadoMovil }, App.icono('cerrar')));
      return c;
    };
    if (lado === 'detalles') {
      var lapiz = esCompu() ? null : h('button.btn.fantasma.icono', { title: 'Perfil, apariencia y permisos de ' + a.nombre, onclick: function () { verLado('perfil'); } }, App.icono('lapiz'));
      App.add(caja, latCab(h('b', 'Detalles'), lapiz), App.Nav.relacionado(a.id));
      return caja;
    }
    var volver = h('button.btn.fantasma.icono', { title: 'Volver a los detalles', onclick: function () { verLado('detalles'); } }, App.icono('atras'));
    var cuerpo = h('div.der-cuerpo'), pie = h('div.der-pie');
    if (lado === 'perfil' || lado === 'permisos') {
      App.add(caja, latCab(volver, h('div.pestanas.lat-pest', [['perfil', 'Perfil y apariencia'], ['permisos', 'Permisos']].map(function (p) {
        return h('button.pestana' + (lado === p[0] ? '.activa' : ''), { onclick: function () { if (lado !== p[0]) verLado(p[0]); } }, p[1]);
      }))), cuerpo, pie);
      if (lado === 'perfil') pintarPerfil(a, cuerpo, pie); else pintarPermisos(a, cuerpo, pie);
      return caja;
    }
    var TIT = { charlas: 'Charlas', tareas: 'Tareas', archivos: 'Archivos', notas: 'Notas' };
    App.add(caja, latCab(volver, h('b', TIT[lado] || '')));
    if (lado === 'charlas') {
      var inp = h('input.campo', { placeholder: 'Buscar en sus charlas', value: ladoFiltro, 'aria-label': 'Buscar en sus charlas' });
      var lista = h('div');
      var llenar = function () { App.vaciar(lista).appendChild(App.Nav.todasLasCharlas(a.id, ladoFiltro.trim().toLowerCase())); };
      inp.addEventListener('input', function () { ladoFiltro = inp.value; llenar(); });
      llenar();
      App.add(caja, h('div.lista-buscar', App.icono('buscar'), inp), App.add(cuerpo, lista));
      setTimeout(function () { inp.focus(); }, 0);
      return caja;
    }
    App.add(caja, cuerpo, pie);
    if (lado === 'tareas') pintarTareas(a, cuerpo, pie);
    else if (lado === 'archivos') pintarArchivos(a, cuerpo, pie);
    else pintarNotas(a, cuerpo, pie);
    return caja;
  }
  /* la lista de charlas cambió (mandaste un mensaje, empezaste otra): título de la charla y columna al día */
  function repintarLado(cual) {
    if (App.modoDerecho() !== 'agente' || !actual) return;
    var t = App.dom.derecho.querySelector('.charla-tit'); if (t && App.Nav.tituloCharla) t.textContent = App.Nav.tituloCharla(actual);
    if (lado === 'detalles' || lado === cual) pintarSoloLado();
  }
  /* la pista «Tocá para ver…» bajo el nombre: hasta que abriste los detalles una vez en este navegador */
  var CLAVE_PISTA = 'oficina.detalles.visto';
  function pistaDetalles() { try { return !localStorage.getItem(CLAVE_PISTA); } catch (e) { return false; } }
  function detallesVistos() {
    try { localStorage.setItem(CLAVE_PISTA, '1'); } catch (e) { /* sin recordar */ }
    var p = App.dom.derecho.querySelector('.agente-pista'); if (p) p.remove();
  }
  /* celular: «4 charlas · 1 tarea · 2 archivos · 3 notas» bajo la cabecera; los que están en cero, más tenues */
  function filaCuentas(a) {
    var ITEMS = [['charlas', 'charla', 'charlas', 'charla'], ['tareas', 'reloj', 'tareas', 'tarea'], ['archivos', 'carpeta', 'archivos', 'archivo'], ['notas', 'lapiz', 'notas', 'nota']];
    var fila = h('div.charla-cuentas', { role: 'group', 'aria-label': 'Lo que tiene ' + a.nombre });
    var chips = {};
    ITEMS.forEach(function (it) {
      var n = h('b', ''), txt = h('span', it[2]);
      var b = h('button.cuenta', { onclick: function () { verLado(it[0]); } }, App.icono(it[1]), n, txt);
      chips[it[0]] = { b: b, n: n, txt: txt, it: it };
      fila.appendChild(b);
    });
    App.Nav.cuentas(a.id, function (clave, cant) {
      var c = chips[clave]; if (!c) return;
      c.n.textContent = String(cant);
      c.txt.textContent = cant === 1 ? c.it[3] : c.it[2];
      c.b.classList.toggle('cero', !cant);
    });
    return fila;
  }
  /* chip de contexto de la charla (contexto.js): el desglose se pide con lo elegido en la charla (modelo, esfuerzo…) */
  function chipContexto(a) {
    return App.ChipContexto.chip(a.id, function () {
      var s = sesiones[a.id];
      return s ? Object.assign({ agent: a.id, session: s }, eleccionDe(s)) : null;
    });
  }
  function pintar() {
    var a = App.agente(actual); if (!a) { cerrar(); return; }
    var d = App.depto(a.departamento);
    var cuerpo = h('div.der-cuerpo'), pie = h('div.der-pie');
    var sub = h('div.sub', a.rol, d ? h('span.insignia', h('span.punto', { style: { background: d.color, marginRight: '5px' } }), d.nombre) : null,
      (a.permisos || []).indexOf('coordinador') >= 0 ? h('span.insignia.coord', 'Coordinador/a') : null);
    var cerrarBtn = h('button.btn.fantasma.icono.cerrar-panel', { title: 'Cerrar', onclick: App.cerrarVentana }, App.icono('cerrar'));
    var der = App.dom.derecho;
    der.removeAttribute('data-lado'); der.removeAttribute('data-visor'); der.classList.remove('lado-movil');
    if (pestana === 'chat' && esCompu() && App.Nav && App.Nav.enSeccion()) {
      /* compu: la charla con tres botones (lápiz: su ficha al costado · pin: dónde está en la oficina · cerrar) y, al
         costado, la columna de detalles. Charla nueva y las otras charlas están en esa columna. */
      App.add(App.vaciar(der),
        h('div.der-cab.agente-cab',
          App.retratoImg(a, 'retrato', 120),
          h('div.der-tit', h('h2', a.nombre), sub),
          h('div.der-acciones.agente-herr',
            h('button.btn.fantasma.icono.agente-lapiz-btn', { title: 'Perfil, apariencia y permisos de ' + a.nombre, 'aria-pressed': String(lado === 'perfil' || lado === 'permisos'),
              onclick: function () { verLado(lado === 'perfil' || lado === 'permisos' ? 'detalles' : 'perfil'); } }, App.icono('lapiz')),
            h('button.btn.fantasma.icono', { title: 'Ver dónde está ' + a.nombre + ' en la oficina', onclick: function () {
              if (App.Oficina3D.marcar) App.Oficina3D.marcar(a.id); else if (App.Oficina3D.enfocarAgente) App.Oficina3D.enfocarAgente(a.id); } }, App.icono('pin')),
            /* cerrar no va acá: queda arriba a la derecha del todo, en la cabecera de la columna del costado */)),
        h('div.charla-barra', h('b.charla-tit', App.Nav.tituloCharla ? App.Nav.tituloCharla(a.id) : ''), chipContexto(a),
          h('button.btn.chico.fantasma.sacar-tareas', { title: 'Convertir esta charla en tareas (para ' + a.nombre + ' o para otros)', onclick: function () { App.ChatTareas.abrir(a, sesiones[a.id]); } }, App.icono('reloj'), 'Sacar tareas')),
        cuerpo, pie);
      der.classList.add('con-relacionado');
      ponerColumnas(a);
      pintarChat(a, cuerpo, pie);
      return;
    }
    if (pestana === 'chat' && !esCompu()) {
      /* celular: como en una app de mensajes, la cabecera entera (cara y nombre, con su flechita) abre los detalles
         encima de la charla; debajo, lo que tiene a la vista con cuántos (charlas, tareas, archivos, notas), y cada uno
         abre su lista. Nueva charla y la ficha (perfil, permisos) están adentro de los detalles. */
      var verDet = function () { verLado('detalles'); };
      var pista = pistaDetalles() ? h('div.agente-pista', 'Tocá para ver sus charlas, archivos y notas') : null;
      App.add(App.vaciar(der),
        h('div.der-cab.agente-cab',
          h('button.agente-toque', { title: 'Detalles de ' + a.nombre + ': charlas, tareas, archivos, notas, perfil y permisos', onclick: verDet },
            App.retratoImg(a, 'retrato', 120),
            h('span.der-tit', h('span.agente-nombre', h('h2', a.nombre), App.icono('flecha')), sub, pista)),
          h('div.der-acciones', chipContexto(a),
            h('button.btn.chico.sacar-tareas', { title: 'Convertir esta charla en tareas (para ' + a.nombre + ' o para otros)', onclick: function () { App.ChatTareas.abrir(a, sesiones[a.id]); } }, App.icono('reloj'), 'Sacar tareas')),
          cerrarBtn),
        filaCuentas(a),
        cuerpo, pie);
    } else if (pestana === 'chat') {
      App.add(App.vaciar(App.dom.derecho),
        h('div.der-cab.agente-cab',
          h('button.agente-cara', { title: 'Ver la ficha de ' + a.nombre + ' (perfil, permisos, notas, tareas, archivos)', onclick: function () { irPestana('perfil'); } },
            App.retratoImg(a, 'retrato', 120), h('span.agente-lapiz', App.icono('lapiz'))),
          h('div.der-tit', h('h2', a.nombre), sub),
          /* con texto: un ícono solo no dice qué hace. La charla actual no se pierde: queda en la lista de Charlas */
          h('div.der-acciones', chipContexto(a),
            h('button.btn.chico.sacar-tareas', { title: 'Convertir esta charla en tareas (para ' + a.nombre + ' o para otros)', onclick: function () { App.ChatTareas.abrir(a, sesiones[a.id]); } }, App.icono('reloj'), 'Sacar tareas'),
            h('button.btn.chico', { title: 'Empezar de cero con ' + a.nombre + '. Esta charla queda guardada en Charlas.', onclick: function () { nueva(a.id); } }, App.icono('mas'), 'Nueva charla')),
          cerrarBtn),
        cuerpo, pie);
    } else {
      App.add(App.vaciar(App.dom.derecho),
        h('div.der-cab.agente-cab.ficha',
          App.retratoImg(a, 'retrato', 96),
          h('div.der-tit', h('h2', a.nombre), sub),
          /* lo que se hace con alguien del equipo, a la vista: charlar, juntarlo en una reunión, darle una tarea */
          h('div.der-acciones',
            h('button.btn.chico', { title: 'Llamar a reunión con ' + a.nombre, onclick: function () { App.Reunion.nueva([a.id]); } }, App.icono('reunion'), h('span.btn-txt', 'Reunión')),
            h('button.btn.chico', { title: 'Nueva tarea para ' + a.nombre, onclick: function () { nuevaTarea(a.id, {}); } }, App.icono('reloj'), h('span.btn-txt', 'Tarea')),
            h('button.btn.chico.primario', { title: 'Ir a la charla con ' + a.nombre, onclick: function () { irPestana('chat'); } }, App.icono('charla'), 'Charlar')),
          cerrarBtn),
        h('div.pestanas', FICHA.map(function (p) {
          return h('button.pestana' + (pestana === p[0] ? '.activa' : ''), { onclick: function () { irPestana(p[0]); } }, p[1]);
        })),
        cuerpo, pie);
    }
    der.classList.remove('con-relacionado');
    if (pestana === 'chat') { pintarChat(a, cuerpo, pie); if (ladoMovil) ponerColumnas(a); }
    else if (pestana === 'perfil') pintarPerfil(a, cuerpo, pie);
    else if (pestana === 'permisos') pintarPermisos(a, cuerpo, pie);
    else if (pestana === 'tareas') pintarTareas(a, cuerpo, pie);
    else if (pestana === 'archivos') pintarArchivos(a, cuerpo, pie);
    else pintarNotas(a, cuerpo, pie);
  }

  /* ---------------- conversación ---------------- */
  function pintarChat(a, cuerpo, pie) {
    var lista = h('div.chat'), sug = h('div.sugerencias');
    App.add(cuerpo, lista, sug);
    var txt = h('textarea.campo', { rows: 1, placeholder: 'Escribile a ' + a.nombre + '…', maxlength: 20000 });
    var enviar = h('button.btn.primario.icono', { title: 'Enviar (Enter)', onclick: mandar }, App.icono('enviar'));
    var parar = h('button.btn.peligro.icono', { style: { display: 'none' }, onclick: function () { detener(a.id); } }, App.icono('parar'));
    var adj = App.Adjuntos();
    adj.zona(cuerpo); adj.zona(pie, txt);
    txt.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); mandar(); } });
    function ajustarAlto() { txt.style.height = 'auto'; txt.style.height = Math.min(160, txt.scrollHeight + 2) + 'px'; }
    txt.addEventListener('input', function () { borradores[a.id] = txt.value; ajustarAlto(); });
    if (borradores[a.id]) { txt.value = borradores[a.id]; setTimeout(ajustarAlto, 0); }
    var claveEleccion = function () { return sesiones[a.id] || 'nueva:' + a.id; };
    var selector = App.SelectorCharla({ modelo: a.modelo, esfuerzo: a.esfuerzo, valor: eleccionDe(claveEleccion()),
      alCambiar: function (v) { guardarEleccion(claveEleccion(), v); } });
    App.add(pie, adj.lista, adj.error, adj.input, h('div.redactar', adj.boton, txt, parar, enviar),
      h('div.pie-charla', selector, h('div.ayuda', 'Enter para enviar (con ' + a.nombre + ' trabajando, queda en cola) · Mayús+Enter para otra línea · arrastrá o pegá archivos')));

    function render() {
      App.vaciar(lista); App.vaciar(sug);
      var msgs = chats[a.id] || [];
      if (!msgs.length) {
        lista.appendChild(h('div.chat-intro', App.retratoImg(a, 'x', 192), h('div', { style: { fontWeight: 600, color: 'var(--texto)' } }, a.nombre), h('div', a.rol)));
        (a.chips || []).forEach(function (c) { sug.appendChild(h('button.chip', { onclick: function () { txt.value = c; mandar(); } }, c)); });
      }
      msgs.forEach(function (m) {
        if (m.r === 'u') {
          // los archivos que le pasaste: los recién mandados (m.adj, nombres) o los guardados en el historial (bloque al final)
          var sp = App.Adjuntos.separar(m.t);
          var chipsAdj = sp.rutas.length ? App.Adjuntos.chips(sp.rutas)
            : (m.adj && m.adj.length ? h('div.adjuntos', m.adj.map(function (n) { return h('div.adjunto', App.icono('clip'), h('span', n)); })) : null);
          lista.appendChild(h('div.msg.u', sp.texto, chipsAdj)).dataset.texto = sp.texto;
        }
        else {
          var plegados = m.pasos ? App.ChatRico.pasosPlegados(m.pasos) : null;
          if (plegados) lista.appendChild(plegados);
          var burbuja = App.htmlSeguro(h('div.msg.a' + (m.e ? '.e' : '')), App.markdown(m.t));
          burbuja.dataset.texto = m.t || '';
          var arch = m.pasos ? App.ChatRico.tarjetasArchivos(m.pasos) : null;
          if (arch) burbuja.appendChild(arch);
          lista.appendChild(burbuja);
          if (m.consultas && m.consultas.length) lista.appendChild(bloqueConsultas(m.consultas));
        }
      });
      refrescarVivo = null;
      if (enCurso[a.id]) {
        var vivoEl = lista.appendChild(App.ChatRico.burbujaVivo(vivos[a.id], a.nombre));
        refrescarVivo = { id: a.id, fn: function () {
          if (!vivoEl.isConnected) return;
          var abajo = cuerpo.scrollHeight - cuerpo.scrollTop - cuerpo.clientHeight < 80;
          var nuevo = App.ChatRico.burbujaVivo(vivos[a.id], a.nombre);
          /* los comandos que la persona desplegó siguen abiertos al refrescar */
          var abiertos = Array.prototype.map.call(vivoEl.querySelectorAll('details.paso-detalle'), function (d) { return d.open; });
          Array.prototype.forEach.call(nuevo.querySelectorAll('details.paso-detalle'), function (d, i) { if (abiertos[i]) d.open = true; });
          vivoEl.replaceWith(nuevo); vivoEl = nuevo;
          if (abajo) cuerpo.scrollTop = cuerpo.scrollHeight;
        } };
      }
      if ((colas[a.id] || []).length) lista.appendChild(bloqueCola(a));
      cuerpo.scrollTop = cuerpo.scrollHeight;
      /* con el agente trabajando se puede seguir escribiendo (queda en cola) y aparece «Detener» */
      var ocup = !!enCurso[a.id];
      enviar.title = ocup ? 'Dejar en cola (Enter): sale cuando ' + a.nombre + ' termine' : 'Enviar (Enter)';
      txt.placeholder = ocup ? 'Dejalo en cola…' : 'Escribile a ' + a.nombre + '…';
      parar.style.display = ocup ? '' : 'none';
      parar.disabled = !!cancelando[a.id];
      parar.title = cancelando[a.id] ? 'Deteniendo…' : 'Detener lo que está haciendo ' + a.nombre;
      /* «Sacar tareas»: solo con una charla que tenga algo tuyo y sin respuesta en curso */
      var sacar = App.dom.derecho.querySelector('.sacar-tareas');
      if (sacar) sacar.disabled = !!enCurso[a.id] || !sesiones[a.id] || !msgs.some(function (m) { return m.r === 'u'; });
    }

    var leyendo = false;
    function mandar() {
      var t = txt.value.trim();
      if ((!t && !adj.hay()) || leyendo) return;
      if (!sesiones[a.id]) {
        sesiones[a.id] = App.uuid();
        guardarEleccion(sesiones[a.id], eleccionDe('nueva:' + a.id)); guardarEleccion('nueva:' + a.id, null);
      }
      var id = a.id, nombres = adj.nombres(), eleccion = selector.valor(), sesion = sesiones[a.id];
      leyendo = true;
      adj.leer().then(function (archivos) {
        txt.value = ''; txt.style.height = '';
        delete borradores[id];
        adj.vaciar();
        var m = { t: t, nombres: nombres, archivos: archivos, eleccion: eleccion, sesion: sesion, guardar: adj.guardarEnBiblioteca };
        // el agente está ocupado: queda en la cola y sale solo cuando termine
        if (enCurso[id]) { (colas[id] = colas[id] || []).push(m); repintar(id); }
        else enviarMensaje(id, m);
      }).catch(function (e) {
        adj.error.textContent = e.message;
      }).then(function () { leyendo = false; });
    }

    repintarChat = { id: a.id, fn: function () { if (lista.isConnected) render(); } };
    if (chats[a.id]) render();
    else {
      lista.appendChild(h('div.vacio', h('span.giro')));
      api.get('/api/historial', { agent: a.id }).then(function (r) {
        if (r.session) sesiones[a.id] = r.session;
        chats[a.id] = (r.msgs || []).map(function (m) { return { r: m.r, t: m.t, e: !!m.e }; });
        App.ChipContexto.fijar(a.id, r.contexto);
        if (App.Nav) App.Nav.pintarLista();    // ya se sabe qué charla es: se marca en la lista
        if (actual === a.id) repintarLado('charlas');   // y en Detalles (si no, queda «Charla nueva» aunque estés en la última)
        return cargarConsultas(a.id).then(function () { if (actual === a.id && pestana === 'chat') render(); });
      }).catch(function () { chats[a.id] = []; render(); });
    }
    setTimeout(function () { txt.focus(); }, 60);
  }

  function ocupado(id, si) {
    if (si) { enCurso[id] = true; App.E.ocupados[id] = true; } else { delete enCurso[id]; delete App.E.ocupados[id]; }
    App.Oficina3D.ocupado(id, si);
    App.marcarEstados();
  }

  /* ---------------- perfil ---------------- */
  function pintarPerfil(a, cuerpo, pie) {
    var cont = h('div', { style: { padding: '14px' } }, App.cargando('Trayendo el perfil…'));
    cuerpo.appendChild(cont);
    api.get('/api/agentes/' + encodeURIComponent(a.id)).then(function (r) {
      if (actual !== a.id || !viendo('perfil')) return;
      var datos = Object.assign({}, r.agente, { prompt: r.prompt, description: r.description || (r.agente && r.agente.description) });
      var ed = App.EditorAgente(datos, { editar: true });
      ed.el.style.gridTemplateColumns = '1fr';
      ed.el.querySelector('.grande').style.cssText = 'width:160px;height:160px';
      var err = h('div.error-txt');
      App.add(App.vaciar(cont), ed.el, filaCoordinador(a), App.Secretaria ? App.Secretaria.seccion(a) : null, err);
      var guardar = h('button.btn.primario', {
        onclick: function () {
          var m = ed.validar(); if (m) { err.textContent = m; return; }
          var v = ed.valor(); delete v.id;
          guardar.disabled = true;
          api.patch('/api/agentes/' + encodeURIComponent(a.id), v).then(function (r2) {
            App.guardado('Cambios guardados.');
            App.actualizar(r2.oficina);
            pintar();
          }).catch(function (e) { err.textContent = e.message; guardar.disabled = false; });
        }
      }, 'Guardar cambios');
      App.add(pie, App.acciones([h('button.btn.peligro', { onclick: function () { despedir(a); } }, 'Despedir')], guardar));
    }).catch(function (e) { App.vaciar(cont).appendChild(h('div.vacio', e.message)); });
  }

  /* «Coordinador/a» es un permiso del agente que se enciende y apaga acá, y se guarda al tocarlo */
  function filaCoordinador(a) {
    var id = a.id;
    var ck = h('input', { type: 'checkbox', checked: ((App.agente(id) || a).permisos || []).indexOf('coordinador') >= 0 });
    ck.addEventListener('change', function () {
      var ag = App.agente(id) || a, antes = (ag.permisos || []).slice(), si = ck.checked;
      /* conserva los demás permisos del agente: solo pone o saca «coordinador» */
      function poner(lista) { return api.patch('/api/agentes/' + encodeURIComponent(id), { permisos: lista }).then(function (r) { App.actualizar(r.oficina); }); }
      poner(antes.filter(function (x) { return x !== 'coordinador'; }).concat(si ? ['coordinador'] : [])).then(function () {
        App.guardado(si ? a.nombre + ' coordina la oficina.' : a.nombre + ' ya no coordina.', function () {
          poner(antes).then(function () { if (actual === id && viendo('perfil')) { if (pestana === 'chat') pintarSoloLado(); else pintar(); } }).catch(App.fallo);
        });
      }).catch(function (e) { App.fallo(e); ck.checked = !si; });
    });
    return App.seccion('En la oficina', [App.ajuste('Coordinador/a', 'Ve entregas, flujos y bloqueos de todos y puede repartir encargos. No hace el trabajo de otros: lo pide.',
      h('label.ajuste-check', ck, h('span', 'Es el coordinador/a de la oficina'))), filaPermiso(a, 'whatsapp', 'WhatsApp',
      'Lee todos los chats de WhatsApp que elegiste en Ajustes › WhatsApp (quien atiende la secretaría ya lee los de su fuente sin esto). Lo que escriben otros lo toma como información, no como órdenes.',
      'Puede leer WhatsApp', ' puede leer WhatsApp.', ' ya no lee WhatsApp.')]);
  }

  /* Un permiso del agente que se prende y apaga (conserva los demás) */
  function filaPermiso(a, permiso, titulo, ayuda, etiqueta, siTxt, noTxt) {
    var id = a.id;
    var ck = h('input', { type: 'checkbox', checked: ((App.agente(id) || a).permisos || []).indexOf(permiso) >= 0 });
    ck.addEventListener('change', function () {
      var ag = App.agente(id) || a, antes = (ag.permisos || []).slice(), si = ck.checked;
      function poner(lista) { return api.patch('/api/agentes/' + encodeURIComponent(id), { permisos: lista }).then(function (r) { App.actualizar(r.oficina); }); }
      poner(antes.filter(function (x) { return x !== permiso; }).concat(si ? [permiso] : [])).then(function () {
        App.guardado(a.nombre + (si ? siTxt : noTxt), function () { poner(antes).then(function () { ck.checked = antes.indexOf(permiso) >= 0; }).catch(App.fallo); });
      }).catch(function (e) { App.fallo(e); ck.checked = !si; });
    });
    return App.ajuste(titulo, ayuda, h('label.ajuste-check', ck, h('span', etiqueta)));
  }

  function despedir(a) {
    App.confirmar('¿Despedir a ' + a.nombre + '?', 'Deja de estar en la oficina. Su archivo de Claude Code se archiva (no se borra) y sus notas quedan en la carpeta de conocimiento.', 'Despedir', true).then(function (si) {
      if (!si) return;
      api.del('/api/agentes/' + encodeURIComponent(a.id)).then(function (r) {
        App.cerrarDerecho();
        App.actualizar(r.oficina);
        App.aviso(a.nombre + ' ya no está en la oficina.');
      }).catch(App.fallo);
    });
  }

  /* ---------------- permisos (docs/plan-creador-flujos.md §12, docs/plan-ui-presentacion.md §3 y §4) ----------------
     Todo se guarda al cambiarlo (PATCH + «Guardado · Deshacer»). Las reglas crudas («Bash(git pull:*)») solo van en el title. */
  var sondeoPermisos = null;

  function pintarPermisos(a, cuerpo) {
    var id = a.id, cont = h('div.perm');
    cuerpo.appendChild(cont);
    function vigente() { return actual === id && viendo('permisos') && cont.isConnected; }
    function ag() { return App.agente(id) || a; }
    var lim = ag().limites || {};
    var solo = (lim.solo || []).slice(), proponer = (lim.proponer || []).slice();
    var reglas = (ag().reglas || []).slice();
    var catalogo = null, carpetaEnt = '';
    var global = ((App.E.estado && App.E.estado.conectores_agentes) || 'por_agente') === 'todos';
    var resumen = h('div.resumen-ui'), zonaReglas = h('div'), zonaConectores = h('div'), zonaHab = h('div');
    var url = '/api/agentes/' + encodeURIComponent(id);

    /* un guardado a la vez: cada uno arma su cuerpo con lo último que quedó guardado */
    var cola = Promise.resolve();
    function guardar(armar, texto, previo) {
      cola = cola.then(function () {
        var cuerpoPatch = armar(); if (!cuerpoPatch) return null;
        return api.patch(url, cuerpoPatch).then(function (r) {
          App.actualizar(r.oficina);
          App.guardado(texto, previo ? function () {
            api.patch(url, previo).then(function (r2) { App.actualizar(r2.oficina); if (vigente()) pintar(); }).catch(App.fallo);
          } : null);
          pintarResumen();
        });
      }).catch(function (e) { App.fallo(e); if (vigente()) pintar(); });
    }
    function copia(x) { return JSON.parse(JSON.stringify(x)); }

    function nombreServ(n) { return App.Ajustes.nombreServidor(n); }
    function conectadosTexto() {
      if (global) return 'todos';
      var nombres = (ag().conectores || []).filter(function (c) { return (c.leer || []).length || (c.actuar || []).length; }).map(function (c) { return nombreServ(c.servidor); });
      return nombres.length ? nombres.join(', ') : 'ninguno';
    }
    function pintarResumen() {
      var corre = App.humano.reglas(reglas).filter(function (g) { return g.tipo === 'correr'; }).length;
      resumen.textContent = a.nombre + ' escribe en sus notas y sus entregables'
        + (reglas.length && App.humano.reglas(reglas).some(function (g) { return g.tipo === 'escribir'; }) ? ' (y en lo que le permitiste)' : '')
        + ' · ' + (corre ? 'puede correr ' + corre + (corre === 1 ? ' comando' : ' comandos') + ' sin preguntar' : 'te pide permiso para correr comandos')
        + ' · conectores: ' + conectadosTexto();
    }

    /* permisos que le diste con «Siempre» al responder un pedido (permisos.js): acá solo se quitan */
    function quitarReglas(crudas, texto) {
      var previo = { reglas: copia(ag().reglas || reglas) };
      reglas = reglas.filter(function (r) { return crudas.indexOf(r) < 0; });
      guardar(function () { return { reglas: reglas.slice() }; }, texto, previo);
    }
    function chipsDeReglas(tipos, vacio, fijos) {
      var grupos = App.humano.reglas(reglas).filter(function (g) { return tipos.indexOf(g.tipo) >= 0; });
      var items = grupos.map(function (g) { return g.texto; });
      function grupoDe(t) { return grupos.filter(function (g) { return g.texto === t; })[0]; }
      if (!items.length && !(fijos && fijos.length)) return h('span.ayuda', vacio);
      return App.chipsEditables(items, { agregar: false, fijos: fijos,
        titulo: function (t) { var g = grupoDe(t); return g ? g.reglas.join(' · ') : t; },
        alCambiar: function (lista, c) {
          if (!c || c.quitado === undefined) return;
          var g = grupoDe(c.quitado); if (!g) return;
          quitarReglas(g.reglas, 'Permiso quitado.');
          pintarReglas();
        } });
    }
    function pintarReglas() {
      App.vaciar(zonaReglas);
      var hay = function (tipos) { return App.humano.reglas(reglas).some(function (g) { return tipos.indexOf(g.tipo) >= 0; }); };
      App.add(zonaReglas,
        App.ajuste('Puede escribir en', 'Solo ahí y en lo que le permitiste. El resto de la oficina lo puede leer, pero no tocar.',
          chipsDeReglas(['escribir'], '', [
            { texto: 'Sus notas', title: 'conocimiento/agentes/' + id + '.md', icono: 'candado', accion: function () { irPestana('notas'); } },
            { texto: 'Sus entregables', title: carpetaEnt || ('archivos/entregables/' + id + '/'), icono: 'candado', accion: function () { irPestana('archivos'); } }])),
        App.ajuste('Puede correr sin preguntar', 'Los comandos a los que le dijiste «Siempre» cuando te pidió permiso. Si quiere correr otro, te pregunta.',
          chipsDeReglas(['correr'], 'Ninguno todavía.')),
        hay(['conector', 'otro']) ? App.ajuste('Otros permisos', 'También los guardaste con «Siempre».', chipsDeReglas(['conector', 'otro'], '')) : null);
      pintarResumen();
    }

    /* conectores: «todos» es una línea; por agente, una fila por servidor con No / Leer / Leer y actuar */
    function nivelActual(s) {
      var o = (ag().conectores || []).filter(function (c) { return c.servidor === s.nombre; })[0] || { leer: [], actuar: [] };
      var tiene = function (tipo) { return App.Ajustes.delTipo(s, tipo).filter(function (n) { return (o[tipo] || []).indexOf(n) >= 0; }).length; };
      if (s._viejo) return (o.actuar || []).length ? 'actuar' : (o.leer || []).length ? 'leer' : 'no';
      return tiene('actuar') ? 'actuar' : tiene('leer') ? 'leer' : 'no';
    }
    function cambiarConector(s, nivel) {
      var previo = { conectores: copia(ag().conectores || []) };
      var t = { leer: nivel !== 'no', actuar: nivel === 'actuar' };
      var porServ = {}; porServ[s.nombre] = t;
      guardar(function () { return { conectores: App.Ajustes.nuevosConectores(ag(), catalogo.servidores, porServ) }; },
        nombreServ(s.nombre) + ': ' + (nivel === 'no' ? 'sin acceso' : nivel === 'leer' ? 'solo leer' : 'leer y actuar') + '.', previo);
    }
    function pintarConectores() {
      App.vaciar(zonaConectores);
      if (global) {
        App.add(zonaConectores, App.ajuste('Conectores', 'Está elegido para toda la oficina.',
          h('div', 'Usa todos los conectores conectados. ', h('button.btn.chico.fantasma', { onclick: function () { App.Ajustes.abrir('conectores'); } }, App.icono('enchufe'), 'Ajustes › Conectores'))));
        return;
      }
      if (!catalogo) { zonaConectores.appendChild(App.seccion('Conectores', App.cargando('Trayendo tus conectores…'))); return; }
      var iaOf = (App.E.oficina && App.E.oficina.ia) || {};
      var habilitado = function (n) { return !iaOf.conectores || iaOf.conectores.some(function (x) { return normServ(x) === normServ(n); }); };
      var todosServs = catalogo.servidores || [], asig = ag().conectores || [];
      // los que la oficina no habilita no se ofrecen (Ajustes › Skills y MCP)
      var servs = todosServs.filter(function (s) { return habilitado(s.nombre); });
      var fuera = todosServs.length - servs.length;
      // servidores asignados que ya no aparecen en el catálogo: se muestran apagados y se conservan
      var extra = asig.filter(function (c) { return habilitado(c.servidor) && !todosServs.some(function (s) { return s.nombre === c.servidor; }); })
        .map(function (c) { return { nombre: c.servidor, disponible: false, herramientas: [], _viejo: c }; });
      var todos = servs.concat(extra);
      var filas = todos.map(function (s) {
        var hayLeer = s._viejo || App.Ajustes.delTipo(s, 'leer').length, hayActuar = s._viejo || App.Ajustes.delTipo(s, 'actuar').length;
        var control;
        if (!s.disponible) control = h('span.ayuda', s._viejo ? 'Ya no aparece en tus conectores.' : 'No disponible · conectalo en claude.ai');
        else {
          var ops = [{ valor: 'no', titulo: 'No' }];
          if (hayLeer) ops.push({ valor: 'leer', titulo: 'Leer' });
          if (hayActuar) ops.push({ valor: 'actuar', titulo: hayLeer ? 'Leer y actuar' : 'Actuar', sub: 'Actuar siempre pide tu aprobación' });
          control = App.elegir({ forma: 'chips', etiqueta: nombreServ(s.nombre), opciones: ops, valor: nivelActual(s), alCambiar: function (v) { cambiarConector(s, v); } });
        }
        return App.ajuste(nombreServ(s.nombre), null, control);
      });
      App.add(zonaConectores, App.seccion('Conectores', [
        catalogo.detectando ? h('div.ayuda', 'Mirando tus conectores de claude.ai… puede tardar un minuto.') : null,
        todos.length ? filas : h('div.ayuda', catalogo.detectando ? '' : fuera ? 'La oficina no habilita ningún conector.' : 'No hay conectores detectados. Conectalos en claude.ai y actualizá la lista en Ajustes › Conectores.'),
        fuera ? h('div.ayuda', fuera === 1 ? 'Hay 1 conector que la oficina no habilita.' : 'Hay ' + fuera + ' conectores que la oficina no habilita.',
          ' ', h('button.btn.chico.fantasma', { onclick: function () { App.Ajustes.abrir('habilitados'); } }, 'Ajustes › Skills y MCP')) : null,
        h('button.btn.chico.fantasma', { onclick: function () { App.Ajustes.abrir('conectores'); } }, App.icono('enchufe'), 'Ver todos los conectores')],
        { ayuda: 'Actuar es hacer algo afuera (mandar, publicar, crear) y siempre queda como propuesta que aprobás vos.' }));
    }

    function normServ(n) { var t = String(n || '').trim().toLowerCase(); return t.indexOf('claude.ai ') === 0 ? t.slice(10).trim() : t; }

    /* skills y MCP de Claude Code: hereda lo que habilita la oficina o elige dentro de eso (PATCH skills/mcp; null = hereda) */
    function pintarHabilitados(cat) {
      App.vaciar(zonaHab);
      var iaOf = (App.E.oficina && App.E.oficina.ia) || {};
      function fila(clave, titulo, catalogoTipo, ayuda, nombreOp) {
        var deOficina = iaOf[clave];
        var base = deOficina ? deOficina.slice() : (catalogoTipo || []).slice();
        var ops = App.Ajustes.opcionesNombres(base);
        if (nombreOp) ops.forEach(nombreOp);
        var el = App.Ajustes.selector({ etiqueta: titulo, opciones: ops, valor: ag()[clave],
          vacio: deOficina ? 'La oficina no habilita ninguno.' : 'No hay nada instalado en tu Claude Code.',
          todo: { titulo: 'Hereda de la oficina', sub: deOficina ? 'Usa los ' + deOficina.length + ' que habilita la oficina' : 'Usa todos los que habilita la oficina' },
          algunas: { titulo: 'Solo los que elijas', sub: 'Dentro de lo que habilita la oficina' },
          alCambiar: function (v) {
            var antes = ag()[clave];
            var previo = {}; previo[clave] = antes === undefined ? null : copia(antes);
            guardar(function () { var c = {}; c[clave] = v; return c; },
              titulo + ': ' + (v ? (v.length ? 'solo ' + v.length + ' de la lista' : 'nada') : 'hereda de la oficina') + '.', previo);
          } });
        return App.ajuste(titulo, ayuda, el);
      }
      App.add(zonaHab, App.seccion('Skills y MCP', [
        fila('skills', 'Skills', cat.skills, 'Las skills de Claude Code que recibe en cada paso. Menos skills, menos tokens.'),
        fila('mcp', 'Servidores MCP', cat.mcp, 'Los MCP de tu Claude Code que puede usar.',
          function (o) { o.titulo = nombreServ(o.sub.replace(/^plugin:[^:]+:/, '')); }),
        h('button.btn.chico.fantasma', { onclick: function () { App.Ajustes.abrir('habilitados'); } }, App.icono('chispa'), 'Lo que habilita la oficina')],
        { ayuda: 'Lo que la oficina no habilita no aparece acá.' }));
    }
    function cargarHabilitados() {
      zonaHab.appendChild(App.seccion('Skills y MCP', App.cargando('Trayendo lo que tenés en Claude Code…')));
      api.get('/api/skills').then(function (r) { if (vigente()) pintarHabilitados(r); })
        .catch(function () { if (vigente()) pintarHabilitados({ skills: [], mcp: [] }); });
    }

    function cargarCatalogo() {
      clearTimeout(sondeoPermisos);
      api.get('/api/conectores').then(function (r) {
        if (!vigente()) return;
        catalogo = r; pintarConectores(); pintarResumen();
        if (r.detectando) sondeoPermisos = setTimeout(function () { if (vigente()) cargarCatalogo(); }, 2000);
      }).catch(function () { if (vigente()) { catalogo = { servidores: [] }; pintarConectores(); } });
    }

    function guardarLimites() {
      var l = ag().limites || {};
      guardar(function () { return { limites: { solo: solo.slice(), proponer: proponer.slice() } }; }, 'Guardado.',
        { limites: { solo: copia(l.solo || []), proponer: copia(l.proponer || []) } });
    }
    var chipsSolo = App.chipsEditables(solo, { placeholder: 'Algo que puede hacer sin preguntarte', max: 12, largo: 300, alCambiar: guardarLimites });
    var chipsProponer = App.chipsEditables(proponer, { placeholder: 'Algo que te tiene que consultar antes', max: 12, largo: 300, alCambiar: guardarLimites });

    App.add(cont, resumen, zonaReglas,
      App.ajuste('Hace solo', 'Lo que resuelve sin consultarte.', chipsSolo),
      App.ajuste('Te consulta antes', 'Mail, publicar o gastar siempre quedan como propuesta, aunque no figure acá.', chipsProponer),
      zonaHab, zonaConectores);
    pintarReglas(); pintarConectores(); cargarHabilitados();
    if (!global) cargarCatalogo();
    api.get('/api/biblioteca/entregables', { agente: id }).then(function (r) {
      if (vigente() && r.carpeta) { carpetaEnt = String(r.carpeta); pintarReglas(); }
    }).catch(function () {});
  }

  /* ---------------- notas ---------------- */
  function pintarNotas(a, cuerpo) {
    var notas = h('div', App.cargando('Trayendo sus notas…'));
    cuerpo.appendChild(h('div', { style: { padding: '14px' } }, h('div.det-sec', h('h4', 'Lo que fue anotando'), notas)));
    api.get('/api/agentes/' + encodeURIComponent(a.id) + '/conocimiento').then(function (r) {
      App.vaciar(notas).appendChild(App.htmlSeguro(h('div.md-doc.doc-panel.notas-doc'), App.markdown(r.texto || 'Todavía no anotó nada.')));
    }).catch(function (e) { App.vaciar(notas).appendChild(h('div.ayuda', e.message)); });
  }

  /* ---------------- archivos que guardó (su carpeta de entregables) ---------------- */
  function pintarArchivos(a, cuerpo, pie) {
    var ent = h('div', App.cargando('Trayendo sus archivos…'));
    cuerpo.appendChild(h('div', { style: { padding: '14px' } }, h('div.det-sec', h('h4', 'Archivos que guardó'), ent)));
    api.get('/api/biblioteca/entregables', { agente: a.id }).then(function (r) {
      App.vaciar(ent);
      if (r.carpeta) App.add(pie, App.acciones(null, h('button.btn', { title: r.carpeta, onclick: function () {
        if (App.nativo.hay && App.E.carpeta) App.nativo.revelar(App.E.carpeta.replace(/\/$/, '') + '/' + r.carpeta);
        else App.Nav.ir('#/archivos/carpeta/' + r.carpeta.split('/').map(encodeURIComponent).join('/'));
      } }, App.icono('carpeta'), App.nativo.hay ? 'Mostrar ' + App.nativo.enExplorador : 'Ver la carpeta')));
      if (!r.entregables || !r.entregables.length) { ent.appendChild(h('div.ayuda', 'Cuando ' + a.nombre + ' guarde trabajos, aparecen acá (' + r.carpeta + ').')); return; }
      r.entregables.forEach(function (x) {
        ent.appendChild(h('div.archivo', { style: { padding: '8px 4px' }, onclick: function () { api.get('/api/biblioteca/entregable', { agente: a.id, ruta: x.ruta }).then(App.abrirContenido).catch(App.fallo); } },
          h('div.tipo', (x.nombre.split('.').pop() || '').slice(0, 4)), h('div.archivo-txt', h('div.archivo-tit', x.nombre), h('div.archivo-meta', App.tam(x.tam || 0)))));
      });
    }).catch(function () { App.vaciar(ent).appendChild(h('div.ayuda', 'No pude leer los entregables.')); });
  }

  /* ---------------- tareas programadas ---------------- */
  var DIAS = [[1, 'L', 'Lunes'], [2, 'M', 'Martes'], [3, 'X', 'Miércoles'], [4, 'J', 'Jueves'], [5, 'V', 'Viernes'], [6, 'S', 'Sábado'], [7, 'D', 'Domingo']];
  var DIAS_CORTO = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  var sondeoTareas = null;

  function zonaSistema() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }
  function textoDias(dias) {
    var d = (dias || []).slice().sort().join(',');
    if (d === '1,2,3,4,5') return 'Lun a vie';
    if (d === '1,2,3,4,5,6,7') return 'Todos los días';
    if (d === '6,7') return 'Fines de semana';
    return (dias || []).slice().sort().map(function (n) { return DIAS_CORTO[n]; }).join(', ');
  }
  /* fecha corta en la zona de la tarea (si no se puede, en la del sistema) */
  function fechaCorta(iso, zona, conDia) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var op = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
    if (conDia) op.weekday = 'short';
    if (zona) op.timeZone = zona;
    try { return d.toLocaleString('es', op); } catch (e) { delete op.timeZone; return d.toLocaleString('es', op); }
  }
  function estadoEjecucion(e) {
    if (!e) return h('span.insignia', 'Todavía no corrió');
    if (e.estado === 'corriendo') return h('span.insignia.aviso', 'Corriendo…');
    if (e.estado === 'esperando_permiso') return h('span.insignia.aviso', 'Esperando tu permiso');
    return h('span.insignia' + (e.estado === 'ok' ? '.ok' : '.error'), e.estado === 'ok' ? 'Hecha' : 'Con error');
  }

  function pintarTareas(a, cuerpo, pie) {
    var cont = h('div', { style: { padding: '14px' } }, App.cargando('Trayendo las tareas…'));
    cuerpo.appendChild(cont);
    var id = a.id;
    function vigente() { return actual === id && viendo('tareas') && cont.isConnected; }
    function cargar() {
      clearTimeout(sondeoTareas);
      api.get('/api/tareas').then(function (r) {
        if (!vigente()) return;
        var mias = (r.tareas || []).filter(function (t) { return t.agente === id; });
        listar(mias);
        // mientras una corre, se vuelve a mirar cada 3 s
        if (mias.some(function (t) { return t.corriendo; })) sondeoTareas = setTimeout(function () { if (vigente()) cargar(); }, 3000);
      }).catch(function (e) { if (vigente()) App.vaciar(cont).appendChild(h('div.vacio', e.message)); });
    }
    var CUANDO_CORREN = 'Corren mientras Oficina está abierta (aunque cierres la ventana). Si la app estuvo cerrada, una que se repite se pone al día al abrirla, hasta 12 horas después de su hora; una de una sola vez se hace igual, aunque sea tarde.';
    function listar(ts) {
      App.vaciar(cont);
      if (!ts.length) {
        cont.appendChild(App.vacio('reloj', 'Todavía no hay tareas', 'Programá algo que ' + a.nombre + ' haga solo: un informe cada mañana (se repite) o un encargo de una sola vez, con su entrega. ' + CUANDO_CORREN));
        return;
      }
      // las de una sola vez ya hechas van al final
      var ordenadas = ts.slice().sort(function (x, y) { return (x.hecha ? 1 : 0) - (y.hecha ? 1 : 0); });
      cont.appendChild(App.seccion('Tareas programadas', ordenadas.map(fila), { cuenta: String(ts.length), ayuda: CUANDO_CORREN }));
    }
    function recargarDespues() { cargar(); if (App.Actividad) setTimeout(App.Actividad.ya, 300); }

    /* estado en una insignia, y qué es lo que hay que hacer: reintentar, ver el pedido de permiso o nada */
    function estadoTarea(t, activa, hecha) {
      var u = t.ultima;
      if (t.corriendo) return { ins: h('span.insignia.aviso', 'Corriendo…') };
      if (u && u.estado === 'esperando_permiso') return { ins: h('span.insignia.aviso', 'Espera tu permiso'), verPedido: true };
      if (hecha) return { ins: h('span.insignia.ok', 'Hecha') };
      if (!activa) return { ins: h('span.insignia', 'En pausa') };
      if (u && u.estado === 'error') return { ins: h('span.insignia.error', 'Falló'), reintentar: true };
      if (!u) return { ins: h('span.insignia', 'Todavía no corrió') };
      return { ins: h('span.insignia.ok', 'Funcionó') };
    }

    function fila(t) {
      var sis = zonaSistema();
      var activa = t.activa !== false;
      var unica = t.tipo === 'unica', hecha = unica && !!t.hecha;
      var zonaTxt = t.zona && t.zona !== sis ? ' (' + t.zona + ')' : '';
      var est = estadoTarea(t, activa, hecha);
      var historial = h('div.tarea-historial.oculto'), abiertoHist = false;
      function verHistorial() {
        abiertoHist = !abiertoHist;
        historial.classList.toggle('oculto', !abiertoHist);
        if (abiertoHist) cargarHistorial(t, historial);
      }
      function probar(btn) {
        btn.disabled = true;
        api.post('/api/tareas/' + encodeURIComponent(t.id) + '/correr').then(function () {
          App.aviso('Probando «' + t.nombre + '»…');
          recargarDespues();
        }).catch(function (e) { App.fallo(e); btn.disabled = false; });
      }
      function editar() { hojaTarea(a, t, cargar); }
      var principal;
      if (est.verPedido) principal = h('button.btn.chico.primario', { onclick: function () { App.Nav.ir('#/bandeja/permisos'); } }, 'Ver pedido');
      else {
        var texto = unica ? (hecha ? 'Hacer de nuevo' : est.reintentar ? 'Reintentar' : 'Hacer ahora') : (est.reintentar ? 'Reintentar' : 'Probar ahora');
        principal = h('button.btn.chico', { disabled: !!t.corriendo, onclick: function (ev) { probar(ev.currentTarget); } }, texto);
      }
      var linea1 = unica ? 'Una sola vez · ' + (t.cuando ? fechaCorta(t.cuando, t.zona, true) : (t.fecha + ' ' + t.hora)) + zonaTxt
        : textoDias(t.dias) + ' · ' + t.hora + zonaTxt;
      var linea2 = unica ? estadoUnica(t, activa, hecha)
        : (activa ? (t.proxima ? 'Próxima: ' + fechaCorta(t.proxima, t.zona, true) : 'Sin próxima corrida') : 'No corre mientras esté en pausa');
      var ultima = t.ultima && !hecha ? 'Última: ' + fechaCorta(t.ultima.inicio, t.zona, false) + (t.ultima.manual ? (unica ? ' (a mano)' : ' (prueba)') : '') : null;
      var filaDec = App.filaDecision({
        marca: 'reloj', titulo: t.nombre, alTocar: editar, estado: est.ins, principal: principal,
        sub: [h('div', linea1), h('div', linea2), ultima ? h('div', ultima) : null],
        mas: [
          { texto: 'Editar', icono: 'lapiz', accion: editar },
          hecha ? null : { texto: activa ? 'Pausar' : 'Reanudar', accion: function () {
            api.patch('/api/tareas/' + encodeURIComponent(t.id), { activa: !activa }).then(function () {
              App.guardado(activa ? 'Tarea en pausa.' : 'Tarea reanudada.', function () {
                api.patch('/api/tareas/' + encodeURIComponent(t.id), { activa: activa }).then(cargar).catch(App.fallo);
              });
              cargar();
            }).catch(App.fallo);
          } },
          { texto: 'Historial', accion: verHistorial },
          '-',
          { texto: 'Borrar', icono: 'papelera', peligro: true, accion: function () {
            App.confirmar('¿Borrar «' + t.nombre + '»?', 'Deja de correr y se borra su historial de ejecuciones. Las conversaciones que ya generó quedan en el chat de ' + a.nombre + '.', 'Borrar', true).then(function (si) {
              if (!si) return;
              api.del('/api/tareas/' + encodeURIComponent(t.id)).then(function () { App.aviso('Tarea borrada.'); cargar(); }).catch(App.fallo);
            });
          } }]
      });
      return h('div.tarea-item' + (activa ? '' : '.pausada'), filaDec,
        t.archivos && t.archivos.length ? h('div.tarea-archivos', App.Adjuntos.chips(t.archivos)) : null, historial);
    }

    /* una sola vez: en qué quedó */
    function estadoUnica(t, activa, hecha) {
      if (hecha) return 'Hecha el ' + fechaCorta(t.hecha, t.zona, false) + '. Su entrega está en Entregables.';
      if (t.corriendo) return 'Haciéndola ahora…';
      if (!activa) return 'No se hace mientras esté en pausa';
      if (t.proxima) return 'Pendiente: se hace ese día a esa hora';
      if (t.ultima && t.ultima.estado === 'error' && !t.ultima.manual) return 'Falló. Reintentala, o cambiale la fecha.';
      return 'Ya es la hora: se hace en cuanto se pueda';
    }

    function cargarHistorial(t, caja) {
      App.vaciar(caja).appendChild(App.cargando('Trayendo el historial…'));
      api.get('/api/tareas/' + encodeURIComponent(t.id) + '/ejecuciones').then(function (r) {
        App.vaciar(caja);
        var es = r.ejecuciones || [];
        if (!es.length) { caja.appendChild(h('div.ayuda', 'Todavía no se ejecutó.')); return; }
        es.forEach(function (e) { caja.appendChild(filaEjecucion(e, t)); });
      }).catch(function (e) { App.vaciar(caja).appendChild(h('div.ayuda', e.message)); });
    }

    function filaEjecucion(e, t) {
      var texto = h('div', { style: { display: 'none', marginTop: '6px' } });
      if (e.estado === 'esperando_permiso') {
        App.add(texto, h('div', 'Frenó: necesita tu permiso para seguir. ', h('button.btn.chico', { onclick: function () { App.Nav.ir('#/bandeja/permisos'); } }, 'Ver pedido')));
      } else {
        var detalle = e.estado === 'error' ? (e.error || 'Falló.') : (e.resultado || (e.estado === 'corriendo' ? 'Todavía está corriendo…' : '(sin respuesta)'));
        App.add(texto, e.estado === 'error' ? h('div.error-txt', detalle) : App.htmlSeguro(h('div.md-doc.doc-panel'), App.markdown(detalle)));
      }
      var ver = h('button.btn.chico.fantasma', { onclick: function () {
        var abierto = texto.style.display !== 'none';
        texto.style.display = abierto ? 'none' : 'block';
        ver.textContent = abierto ? 'Ver texto' : 'Ocultar';
      } }, 'Ver texto');
      var chatBtn = e.sid && e.estado !== 'corriendo' ? h('button.btn.chico.fantasma', { onclick: function () { abrirSesion(a, e.sid); } }, 'Abrir en el chat') : null;
      var costo = typeof e.costo === 'number' && e.costo > 0 ? ' · ≈ US$ ' + e.costo.toFixed(2) : '';
      return h('div', { style: { borderTop: '1px solid var(--linea)', padding: '7px 0' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          estadoEjecucion(e),
          h('span.ayuda', { style: { margin: 0, flex: 1 } }, fechaCorta(e.inicio, null, false) + (e.manual ? (t && t.tipo === 'unica' ? ' · a mano' : ' · prueba') : '') + costo),
          ver, chatBtn),
        texto);
    }

    cargar();
    App.add(pie, App.acciones(null, h('button.btn.primario', { onclick: function () { hojaTarea(a, null, cargar); } }, 'Nueva tarea')));
  }

  /* charla nueva con el agente: sesión nueva y vacía (la anterior queda en la lista de charlas) */
  function nueva(id) {
    if (!App.agente(id)) return;
    sesiones[id] = App.uuid(); chats[id] = []; delete borradores[id]; soltarCola(id);
    App.ChipContexto.fijar(id, null);
    ladoMovil = false;
    sesionFija = sesiones[id];
    if (actual === id && App.modoDerecho() === 'agente') { pestana = 'chat'; pintar(); App.abrirDerecho('agente'); }
    else abrir(id, 'chat');
  }

  /* abre la conversación de una ejecución en la pestaña de chat (se puede seguir escribiendo en esa sesión) */
  function abrirSesion(a, sid) {
    api.get('/api/historial', { agent: a.id, session: sid }).then(function (r) {
      sesiones[a.id] = sid; soltarCola(a.id);
      chats[a.id] = (r.msgs || []).map(function (m) { return { r: m.r, t: m.t, e: !!m.e }; });
      App.ChipContexto.fijar(a.id, r.contexto);
      pestana = 'chat';
      pintar();
      if (App.Nav) App.Nav.pintarLista();
    }).catch(App.fallo);
  }

  /* hoja para crear (t = null) o editar una tarea. `a` puede ser null al crear: arriba se elige para quién es. */
  /* `pre` (solo al crear): {nombre, consigna, origen, unica} precargados, p. ej. desde un pendiente de reunión */
  function hojaTarea(a, t, alGuardar, pre) {
    pre = pre || {};
    var agentes = (App.E.oficina && App.E.oficina.agentes) || [];
    if (!a && t) a = App.agente(t.agente);
    var elegido = a || (agentes.length === 1 ? agentes[0] : null);
    function nom() { return elegido ? elegido.nombre : 'el agente'; }
    function tituloHoja() { return t ? 'Editar tarea' : (elegido ? 'Nueva tarea de ' + elegido.nombre : 'Nueva tarea'); }
    var hj = App.hoja({ titulo: tituloHoja(), ancho: 540 });
    var nombre = h('input.campo', { value: t ? t.nombre : (pre.nombre || ''), maxlength: 80, placeholder: 'Por ejemplo: Informe de la mañana', autofocus: true });
    var consigna = h('textarea.campo', { rows: 6, maxlength: 4000 });
    consigna.value = t ? t.consigna : (pre.consigna || '');
    var unica = t ? t.tipo === 'unica' : !!pre.unica;
    var hecha = !!(t && t.hecha);
    var ahora = !t;   // al crear una de una sola vez, por defecto «Ahora»

    function hoyISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    function campo(etq, ayuda, control) { return h('div.fila-campo', h('label.etiqueta-campo', etq), ayuda || null, control); }

    var agenteEl = a ? null : App.elegir({ etiqueta: 'Para quién', valor: elegido ? elegido.id : null,
      opciones: agentes.map(function (x) { return { valor: x.id, titulo: x.nombre, retrato: x }; }),
      alCambiar: function (id) { elegido = App.agente(id); hj.titulo(tituloHoja()); pintarTipo(); } });
    var tipoEl = App.elegir({ etiqueta: 'Tipo', valor: unica, opciones: [{ valor: false, titulo: 'Se repite' }, { valor: true, titulo: 'Una sola vez' }],
      alCambiar: function (v) { unica = v; pintarTipo(); } });
    var cuandoEl = t ? null : App.elegir({ etiqueta: 'Cuándo', valor: ahora, opciones: [{ valor: true, titulo: 'Ahora' }, { valor: false, titulo: 'En una fecha' }],
      alCambiar: function (v) { ahora = v; pintarTipo(); } });
    var diasEl = App.elegir({ multiple: true, forma: 'chips', etiqueta: 'Días', valor: (t ? t.dias : [1, 2, 3, 4, 5]),
      opciones: DIAS.map(function (d) { return { valor: d[0], titulo: DIAS_CORTO[d[0]].charAt(0).toUpperCase() + DIAS_CORTO[d[0]].slice(1), sub: d[2] }; }) });
    var hora = h('input.campo', { type: 'time', value: t ? t.hora : '08:00', step: 60, style: { width: '130px' } });
    var fecha = h('input.campo', { type: 'date', value: t && t.fecha ? t.fecha : hoyISO(), style: { width: '170px' } });
    var zona = h('input.campo', { value: t ? t.zona : zonaSistema(), placeholder: 'America/Argentina/Buenos_Aires', list: 'hq-zonas', autocomplete: 'off', spellcheck: 'false' });
    var lista = h('datalist', { id: 'hq-zonas' });
    try { (Intl.supportedValuesOf('timeZone') || []).forEach(function (z) { lista.appendChild(h('option', { value: z })); }); } catch (e) { /* sin lista: se escribe a mano */ }
    var zonaAbierta = !!(t && t.zona && t.zona !== zonaSistema());
    var activa = h('input', { type: 'checkbox', checked: t ? t.activa !== false : true });
    var err = h('div.error-txt');
    var ayudaTipo = h('div.ayuda'), ayudaConsigna = h('div.ayuda'), ayudaArchivos = h('div.ayuda');
    /* archivos: los que ya lleva la tarea (se pueden sacar) y los nuevos */
    var adj = App.Adjuntos({ texto: 'Adjuntar archivos', error: err });
    adj.zona(hj.cuerpo, consigna);
    var quitados = [], guardados = h('div');
    function pintarGuardados() {
      var quedan = ((t && t.archivos) || []).filter(function (r) { return quitados.indexOf(r) < 0; });
      App.vaciar(guardados);
      if (quedan.length) guardados.appendChild(App.Adjuntos.chips(quedan, function (r) { quitados.push(r); pintarGuardados(); }));
    }
    pintarGuardados();

    var filaAgente = agenteEl ? campo('Para quién', h('div.ayuda', 'Quién se encarga de la tarea.'), agenteEl) : null;
    var filaDias = campo('Días', null, diasEl);
    var filaCuando = t ? null : campo('Cuándo', null, cuandoEl);
    var filaFecha = campo('Fecha', null, fecha);
    var filaHora = campo('Hora', null, hora);
    var zonaCaja = campo('Zona horaria', h('div.ayuda', 'Por defecto la de tu compu.'), [zona, lista]);
    var zonaLink = h('div.ayuda', 'Hora de ' + (zonaSistema() || 'tu compu') + ' · ',
      h('button.btn.fantasma.chico', { type: 'button', onclick: function () { zonaAbierta = true; pintarTipo(); } }, 'Otra zona horaria'));
    var filaActiva = h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', cursor: 'pointer' } }, activa, 'Activa');
    var notaHecha = h('div.ayuda', 'Esta tarea ya se hizo. Si le cambiás la fecha o la hora, se vuelve a hacer (y deja otra entrega).');
    function ver(el, si) { if (el) el.style.display = si ? '' : 'none'; }
    function pintarTipo() {
      var unaYa = unica && !t && ahora;
      ver(filaDias, !unica); ver(filaCuando, unica); ver(filaFecha, unica && !unaYa);
      ver(filaHora, !unaYa); ver(zonaLink, !unaYa && !zonaAbierta); ver(zonaCaja, !unaYa && zonaAbierta);
      ver(filaActiva, !unaYa && !hecha); ver(notaHecha, unica && hecha);
      ayudaTipo.textContent = unica ? 'Se hace una vez y la tarea queda hecha.' : 'Corre los días y a la hora que elijas, todas las semanas.';
      consigna.placeholder = unica ? 'Lo que ' + nom() + ' tiene que hacer y entregar, como si se lo escribieras en el chat.'
        : 'Lo que ' + nom() + ' tiene que hacer cada vez, como si se lo escribieras en el chat.';
      ayudaConsigna.textContent = unica
        ? 'Se hace en una conversación nueva y con sus permisos de siempre. Deja una entrega para revisar.'
        : 'Se le pide al agente en una conversación nueva cada vez, con sus permisos de siempre. Cada vez deja una entrega.';
      ayudaArchivos.textContent = 'Lo que ' + nom() + ' tiene que mirar cada vez que haga la tarea (fotos, documentos…).';
      guardar.textContent = t ? 'Guardar cambios' : (unaYa ? 'Encargar ahora' : 'Crear tarea');
    }

    /* salió de una charla: con quién, y un botón para volver a ella */
    var filaCharla = t && t.charla && t.origen && t.origen.chat ? h('div.ct-de-charla', App.icono('charla'),
      h('span', 'Salió de una charla con ', h('b', t.charla.nombre)),
      h('button.btn.chico.fantasma', { type: 'button', onclick: function () { hj.cerrar(); App.Agente.abrirSesion(t.charla.agente, t.origen.chat); } }, 'Ver la charla')) : null;
    App.add(hj.cuerpo,
      filaCharla,
      filaAgente,
      campo('Tipo', ayudaTipo, tipoEl),
      campo('Nombre', null, nombre),
      campo('Consigna', ayudaConsigna, consigna),
      campo('Archivos', ayudaArchivos, [guardados, h('div', adj.boton, adj.input), adj.lista]),
      filaCuando, filaDias,
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' } }, filaFecha, filaHora),
      zonaLink, zonaCaja,
      filaActiva, notaHecha,
      err);
    var guardar = h('button.btn.primario', { onclick: function () {
      if (!elegido) { err.textContent = 'Elegí para quién es la tarea.'; return; }
      var d = diasEl.valor().map(Number).sort(function (x, y) { return x - y; });
      var cuerpo = { nombre: nombre.value.trim(), consigna: consigna.value.trim(), zona: (zonaAbierta ? zona.value.trim() : '') || (t ? t.zona : '') || zonaSistema() };
      if (!cuerpo.nombre) { err.textContent = 'Poné un nombre.'; return; }
      if (!cuerpo.consigna) { err.textContent = 'Escribí la consigna.'; return; }
      if (unica && !t && ahora) {
        cuerpo.tipo = 'unica'; cuerpo.ahora = true;
      } else {
        cuerpo.hora = hora.value;
        if (!/^\d\d:\d\d$/.test(cuerpo.hora)) { err.textContent = 'Elegí la hora.'; return; }
        if (!hecha) cuerpo.activa = activa.checked;
        if (unica) {
          cuerpo.tipo = 'unica'; cuerpo.fecha = fecha.value;
          if (!/^\d{4}-\d\d-\d\d$/.test(cuerpo.fecha)) { err.textContent = 'Elegí la fecha.'; return; }
        } else {
          cuerpo.tipo = 'repetida'; cuerpo.dias = d;
          if (!d.length) { err.textContent = 'Elegí al menos un día.'; return; }
        }
      }
      guardar.disabled = true; err.textContent = '';
      if (t && quitados.length) cuerpo.quitarArchivos = quitados;
      var leidos = [];
      var p = adj.leer().then(function (archivos) {
        leidos = archivos;
        if (archivos.length) cuerpo.archivos = archivos;
        return t ? api.patch('/api/tareas/' + encodeURIComponent(t.id), cuerpo)
          : api.post('/api/tareas', Object.assign({ agente: elegido.id }, pre.origen ? { origen: pre.origen } : {}, cuerpo));
      }).then(function (r) { adj.guardarEnBiblioteca(leidos); return r; });
      p.then(function () {
        hj.cerrar();
        App.aviso(t ? 'Cambios guardados.' : (cuerpo.ahora ? elegido.nombre + ' se puso a trabajar en eso.' : 'Tarea creada.'));
        if (cuerpo.ahora && App.Actividad) setTimeout(App.Actividad.ya, 300);
        if (alGuardar) alGuardar();
      }).catch(function (e) { err.textContent = e.message; guardar.disabled = false; });
    } }, t ? 'Guardar cambios' : 'Crear tarea');
    App.add(hj.pie, h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), guardar);
    pintarTipo();
  }

  function cerrar() { if (App.modoDerecho() === 'agente') App.cerrarDerecho(); else alCerrar(); }
  function alCerrar() { actual = null; App.Oficina3D.elegir(null); App.marcarEstados(); }

  /* abre la hoja de «Nueva tarea» (de un agente, o sin agente: arriba se elige) con datos precargados (desde un pendiente de reunión) */
  function nuevaTarea(id, pre, alGuardar) {
    var a = id ? App.agente(id) : null;
    if (id && !a) return;
    hojaTarea(a, null, alGuardar, pre);
  }
  /* abre la hoja de «Editar tarea» desde fuera de la ficha (el panel global de Tareas) */
  function editarTarea(t, alGuardar) {
    var a = App.agente(t.agente); if (!a) return;
    hojaTarea(a, t, alGuardar);
  }

  App.Agente = { abrir: abrir, abrirVisor: abrirVisor, cerrar: cerrar, alCerrar: alCerrar, actual: function () { return actual; }, nuevaTarea: nuevaTarea, editarTarea: editarTarea,
    /* abre una conversación concreta del agente (p. ej. la de una entrega) en su pestaña de chat */
    abrirSesion: function (id, sid) {
      var a = App.agente(id); if (!a) return;
      actual = id; sesionFija = sid; pestana = 'chat'; App.Oficina3D.elegir(id); App.abrirDerecho('agente'); abrirSesion(a, sid); App.marcarEstados();
    },
    nueva: nueva,
    sesion: function (id) { return sesiones[id] || null; },
    sesionFija: function () { return sesionFija; },
    pestana: function () { return actual ? pestana : 'chat'; },
    lado: function () { return pestana === 'chat' ? lado : pestana; }, verLado: verLado, repintarLado: repintarLado, PESTANAS: PESTANAS };
})();
