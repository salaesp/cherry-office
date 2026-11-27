/* Navegación: riel de secciones, columna de lista y rutas con # (Atrás y Adelante funcionan).
   Los módulos siguen pintando en App.dom.derecho y llamando a App.abrirDerecho(modo). Acá se decide dónde se ve:
   - Bandeja: lo que te espera (para revisar, permisos pendientes, parte del día).
   - Oficina: la maqueta, sola (como mostrar el escritorio: cierra la ventana abierta, igual que su ×).
   - Equipo (como un chat: cada persona es un contacto; tocarla abre su charla, con sus otras charlas, tareas, archivos y
     notas al costado; en otra pestaña, las reuniones), Archivos y Trabajo.
   Cada botón del riel abre una ventana (App.dom.ventana: la lista de la sección y el panel) sobre la oficina viva; de a
   una, y su × la cierra. En la compu flota centrada si sobra oficina o va pegada al riel si no (acomodar); en el
   celular ocupa la pantalla.
   Se sincroniza en los dos sentidos: una ruta abre el módulo, y un módulo abierto desde otro lado (un aviso, la
   maqueta, ⌘K) deja la ruta que le corresponde en el historial. */
App.Nav = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var api = function () { return App.api; };

  /* `movil`: en el celular la barra de abajo muestra solo estas; el resto va en «Más» */
  var SECCIONES = [
    { id: 'bandeja', texto: 'Bandeja', icono: 'bandeja', ruta: '#/bandeja', movil: true },
    { id: 'oficina', texto: 'Oficina', icono: 'edificio', ruta: '#/oficina' },
    { id: 'equipo', texto: 'Equipo', icono: 'personas', ruta: '#/equipo', movil: true },
    { id: 'archivos', texto: 'Archivos', icono: 'carpeta', ruta: '#/archivos', movil: true },
    { id: 'trabajo', texto: 'Trabajo', icono: 'reloj', ruta: '#/trabajo' }
  ];
  /* modo del panel -> sección y subsección (el agente depende de la pestaña: la charla en Charlas, la ficha en Equipo) */
  var LUGAR = {
    reunion: ['equipo', 'reuniones'],
    entregables: ['bandeja', 'revisar'], permisos: ['bandeja', 'permisos'], parte: ['bandeja', 'hoy'],
    departamentos: ['equipo', 'departamentos'], contratar: ['equipo', 'contratar'], creador: ['equipo', 'creador'],
    'reunion-nueva': ['equipo', 'reuniones'], 'flujos-editor': ['trabajo', 'flujos'],
    biblioteca: ['archivos', 'biblioteca'], conocimiento: ['archivos', 'conocimiento'], carpeta: ['archivos', 'carpeta'],
    tareas: ['trabajo', 'tareas'], flujos: ['trabajo', 'flujos']
  };
  function lugarDe(modo) {
    if (modo === 'agente') return ['equipo'];
    return LUGAR[modo];
  }
  var seccion = null, sub = null;
  var aplicando = false;        // mientras una ruta abre un módulo, el módulo no vuelve a escribir la ruta
  var dom = {};                 // riel, lista, items del riel
  var sesiones = null;          // cache de /api/sesiones
  var reuniones = null;         // cache de /api/reuniones
  var buscar = '';
  var eqTab = 'personas';       // pestaña de la lista de Equipo: personas o reuniones
  var plegado = {};
  try { plegado = JSON.parse(localStorage.getItem('oficina.nav.plegado') || '{}') || {}; } catch (e) {}

  function esMovil() { return window.matchMedia('(max-width: 720px)').matches; }
  function leer() {
    var p = (location.hash || '').replace(/^#\/?/, '').split('/').map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    // #/reuniones/<id> es una reunión: se ve dentro de Equipo › Reuniones
    // #/charlas/… es una ruta vieja (se redirige a Equipo en aplicar)
    var sec = p[0] === 'reuniones' || p[0] === 'charlas' || SECCIONES.some(function (s) { return s.id === p[0]; }) ? p[0] : 'oficina';
    return { sec: sec, a: p[1] || null, b: p[2] || null, resto: p.slice(2).join('/') };
  }
  function empujar(ruta, reemplazar) {
    if (location.hash === ruta) return;
    if (reemplazar) history.replaceState(null, '', ruta); else history.pushState(null, '', ruta);
  }

  /* ---------------- riel ---------------- */
  /* `op`: {menuOficina(ancla), menuNuevo(ancla), insignias: {seccion: elemento}, extra: [elementos abajo]} */
  function riel(op) {
    dom.items = {};
    var items = SECCIONES.map(function (s, i) {
      var b = h('button.riel-item' + (s.movil ? '' : '.riel-no-movil'), { title: s.texto + ' (' + (App.atajoMod || '⌘') + (i + 1) + ')', onclick: function () {
        var app = App.dom.app;   // con la lista plegada, tocar la sección en la que estás la muestra encima
        if (s.id === seccion && app.classList.contains('lista-plegada')) { app.classList.toggle('lista-ver'); return; }
        ir(s.id === 'oficina' ? s.ruta : rutaSeccion(s.id));
      } },
        App.icono(s.icono), h('span', s.texto), op.insignias && op.insignias[s.id] ? op.insignias[s.id] : null);
      dom.items[s.id] = b;
      return b;
    });
    dom.riel = h('nav.riel',
      h('button.riel-logo', { title: 'Cambiar de oficina', onclick: function (ev) { op.menuOficina(ev.currentTarget); } }, App.logo()),
      h('button.riel-nuevo', { title: 'Nuevo…', onclick: function (ev) { op.menuNuevo(ev.currentTarget); } }, App.icono('mas')),
      items,
      h('button.riel-item.riel-mas', { title: 'Más', onclick: function (ev) { menuMas(ev.currentTarget); } }, App.icono('menu'), h('span', 'Más')),
      h('div.riel-sep'), op.extra || null);
    return dom.riel;
  }
  /* celular: lo que no entra en la barra de abajo */
  function menuMas(ancla) {
    var items = SECCIONES.filter(function (s) { return !s.movil; }).map(function (s) {
      return { texto: s.texto, icono: s.icono, accion: function () { ir(s.id === 'oficina' ? s.ruta : rutaSeccion(s.id)); } };
    });
    items.push('-',
      { texto: 'Buscar o ir a…', icono: 'buscar', accion: function () { App.Paleta.abrir(); } },
      { texto: 'Ajustes', icono: 'ajustes', accion: function () { App.Ajustes.abrir(); } },
      { texto: 'Cambiar de oficina…', icono: 'edificio', accion: function () { App.menuOficina(ancla); } });
    App.menu(ancla, items);
  }
  /* la última subsección que miraste de cada sección (Archivos › Biblioteca, Trabajo › Flujos…) */
  var ultimaSub = { bandeja: 'hoy', archivos: 'biblioteca', trabajo: 'tareas' };
  function rutaSeccion(id) {
    if (ultimaSub[id]) return '#/' + id + (esMovil() ? '' : '/' + ultimaSub[id]);
    return '#/' + id;
  }

  /* ---------------- secciones ---------------- */
  function ponerSeccion(sec, s) {
    var antes = seccion;
    seccion = sec; sub = s || null;
    if (antes !== sec && sec === 'equipo' && sesiones) cargarSesiones();      // al entrar, se pone al día sin parpadear
    if (antes !== sec && sec === 'equipo' && reuniones) cargarReuniones();
    if (sec === 'equipo' && s === 'reuniones') eqTab = 'reuniones';
    if (s && ultimaSub[sec] !== undefined && s !== 'carpeta') ultimaSub[sec] = s;
    var app = App.dom.app;
    app.classList.toggle('en-oficina', sec === 'oficina');
    app.classList.toggle('en-seccion', sec !== 'oficina');
    app.setAttribute('data-seccion', sec);
    /* la oficina sigue viva detrás de las secciones; solo en el celular (donde el panel la tapa entera) se pausa */
    if (App.Oficina && App.Oficina.pausar) App.Oficina.pausar(sec !== 'oficina' && esMovil());
    Object.keys(dom.items || {}).forEach(function (k) {
      dom.items[k].classList.toggle('activo', k === sec);
      if (k === sec) dom.items[k].setAttribute('aria-current', 'page'); else dom.items[k].removeAttribute('aria-current');
    });
    marcarDetalle();
    pintarLista();
  }
  function marcarDetalle() {
    var m = App.modoDerecho ? App.modoDerecho() : null;
    App.dom.app.classList.toggle('con-detalle', seccion !== 'oficina' && !!m && m !== 'vacio');
    acomodar();
  }
  /* En la compu, la forma de la ventana (lista + panel) según cuánta oficina deja libre:
     - LIBRE px o más: flota centrada como una tarjeta, con la oficina a los costados;
     - menos: va pegada al riel, de arriba abajo, y la lista se pliega (tocar la sección en el riel la muestra encima).
     La cámara de la oficina centra en el hueco a la derecha de la ventana. */
  var LIBRE = 360;
  function acomodar() {
    var app = App.dom && App.dom.app; if (!app) return;
    requestAnimationFrame(function () {
      var ven = App.dom.ventana, vista = ven.parentNode, enSec = seccion && seccion !== 'oficina' && !esMovil();
      var lista = app.classList.contains('lista-ver');
      app.classList.remove('lista-plegada', 'panel-flotante');   // se mide la ventana entera, pegada al riel
      var libre = vista.offsetWidth - (enSec ? ven.offsetWidth : 0);
      var flota = enSec && libre >= LIBRE;
      var plegar = enSec && !flota && app.classList.contains('con-detalle');
      app.classList.toggle('lista-plegada', plegar);
      app.classList.toggle('lista-ver', plegar && lista);
      app.classList.toggle('panel-flotante', flota);
      if (App.Oficina && App.Oficina.margen) App.Oficina.margen(enSec ? ven.offsetLeft + ven.offsetWidth : 0);
    });
  }
  window.addEventListener('resize', function () { if (App.dom && App.dom.app) acomodar(); });

  /* El panel vacío de una sección (nada elegido todavía). Cierra lo que hubiera con su limpieza de siempre. */
  function vacio() {
    if (App.modoDerecho() && App.modoDerecho() !== 'vacio') App.cerrarDerecho(true);
    var der = App.dom.derecho;
    der.classList.remove('con-relacionado', 'lado-movil');
    der.classList.add('abierto'); der.setAttribute('data-modo', 'vacio');
    var txt = {
      bandeja: ['bandeja', 'Lo que te espera', 'Hoy junta lo que te entregaron, los permisos que te piden y lo que pasó.'],
      equipo: ['personas', 'Tu equipo', 'Tocá a alguien, acá o en la oficina, para charlar. Al costado de la charla vas a ver sus otras charlas, sus tareas, sus archivos y sus notas.'],
      archivos: ['carpeta', 'Archivos de la oficina', 'La carpeta de la oficina, la biblioteca y lo que sabe la oficina.'],
      trabajo: ['reloj', 'Lo que los agentes hacen solos', 'Tareas programadas y flujos que pasan de un agente a otro.']
    }[seccion] || ['edificio', '', ''];
    var accion = seccion === 'equipo' && eqTab === 'reuniones' ? h('button.btn.primario', { onclick: function () { App.Reunion.nueva(); } }, App.icono('reunion'), 'Llamar a reunión')
      : seccion === 'equipo' ? h('button.btn.primario', { onclick: function () { App.Contratar.abrir(); } }, App.icono('mas'), 'Contratar un agente') : null;
    App.add(App.vaciar(der), esMovil() ? null : h('button.btn.fantasma.icono.nav-vacio-cerrar', { title: 'Cerrar', onclick: App.cerrarVentana }, App.icono('cerrar')),
      h('div.nav-vacio', App.icono(txt[0]), h('b', txt[1]), h('p', txt[2]), accion));
    marcarDetalle();
  }

  /* ---------------- rutas -> módulos ---------------- */
  function aplicar() {
    var r = leer(), m = App.modoDerecho();
    aplicando = true;
    try {
      /* rutas viejas: lo que esperaba tu revisión vivía en Archivos */
      if (r.sec === 'archivos' && r.a === 'revisar') { empujar('#/bandeja/revisar' + (r.b ? '/' + r.b : ''), true); r = leer(); }
      /* rutas viejas: Charlas ya no existe; las charlas y las reuniones viven en Equipo */
      if (r.sec === 'charlas') {
        empujar(r.a === 'nueva-reunion' ? '#/equipo/nueva-reunion' : r.a ? '#/equipo/' + encodeURIComponent(r.a) + (r.b ? '/' + r.b : '') : '#/equipo', true); r = leer();
      }
      var enChat = m === 'agente' && App.Agente.pestana() === 'chat';
      if (r.sec === 'oficina') {
        ponerSeccion('oficina');
        if (m) App.cerrarDerecho(true);
      } else if (r.sec === 'bandeja') {
        if (!r.a && !esMovil()) { empujar('#/bandeja/hoy', true); r.a = 'hoy'; }   // en la compu, la Bandeja abre en Hoy
        ponerSeccion('bandeja', r.a === 'parte' ? 'hoy' : r.a);
        if (r.a === 'revisar') {
          var ab = m === 'entregables' ? App.Entregables.abierta() : undefined;
          if (r.b) { if (ab !== +r.b) App.Entregables.abrir(+r.b); }
          else if (m !== 'entregables' || ab) App.Entregables.abrir();
        } else if (r.a === 'permisos') { if (m !== 'permisos') App.Permisos.abrirPanel(); }
        else if (r.a === 'hoy' || r.a === 'parte') { if (m !== 'parte') App.Parte.abrir(); }
        else vacio();
      } else if (r.sec === 'equipo') {
        ponerSeccion('equipo', ['departamentos', 'contratar', 'creador', 'reuniones', 'nueva-reunion'].indexOf(r.a) >= 0 ? (r.a === 'nueva-reunion' ? 'reuniones' : r.a) : null);
        if (r.a === 'departamentos') { if (m !== 'departamentos') abrirDepartamentos(); }
        else if (r.a === 'contratar') { if (m !== 'contratar') App.Contratar.abrir(); }
        else if (r.a === 'creador') { if (m !== 'creador') App.Creador.abrir(); }
        else if (r.a === 'nueva-reunion') { if (m !== 'reunion-nueva') App.Reunion.nueva(); }
        else if (r.a === 'reuniones') { eqTab = 'reuniones'; vacio(); }
        else if (r.a && App.agente(r.a)) {
          eqTab = 'personas';
          /* #/equipo/<id> es su charla; #/equipo/<id>/<sesión> una charla guardada; #/equipo/<id>/<pestaña> abre su
             ficha (perfil, permisos…): en la compu, al costado de la charla; en el celular, en lugar de la charla */
          var esPest = App.Agente.PESTANAS.indexOf(r.b) >= 0;
          if (r.b && !esPest) { if (!(enChat && App.Agente.actual() === r.a && App.Agente.sesion(r.a) === r.b)) App.Agente.abrirSesion(r.a, r.b); }
          else if (esPest) { if (!(m === 'agente' && App.Agente.actual() === r.a && App.Agente.lado() === r.b)) App.Agente.abrir(r.a, r.b); }
          else if (!(enChat && App.Agente.actual() === r.a)) App.Agente.abrir(r.a, 'chat');
        } else vacio();
      } else if (r.sec === 'reuniones') {
        ponerSeccion('equipo', 'reuniones');
        if (r.a) { if (!(m === 'reunion' && App.Reunion.abierta() === r.a)) App.Reunion.ver(r.a); }
        else { empujar('#/equipo/reuniones', true); vacio(); }
      } else if (r.sec === 'archivos') {
        ponerSeccion('archivos', r.a);
        if (r.a === 'biblioteca') { if (m !== 'biblioteca') App.Biblioteca.abrir(); }
        else if (r.a === 'conocimiento') { if (m !== 'conocimiento') App.Conocimiento.abrir(); }
        else if (r.a === 'carpeta') { if (!(m === 'carpeta' && App.Carpeta.ruta() === (r.resto || ''))) App.Carpeta.abrir(r.resto || ''); }
        else vacio();
      } else if (r.sec === 'trabajo') {
        ponerSeccion('trabajo', r.a);
        if (r.a === 'flujos' && r.b === 'editar') {
          var ed = m === 'flujos-editor' && App.Flujos.editando ? App.Flujos.editando() : undefined;
          if (m !== 'flujos-editor' || String(ed || '') !== (r.resto.split('/')[1] || '')) App.Flujos.editor(r.resto.split('/')[1] || null);
        } else if (r.a === 'flujos') {
          var co = m === 'flujos' && App.Flujos.corridaAbierta ? App.Flujos.corridaAbierta() : undefined;
          if (r.b) { if (co !== +r.b) App.Flujos.verCorrida(r.b); }
          else if (m !== 'flujos' || co) App.Flujos.abrir();
        }
        else if (r.a === 'tareas') { if (m !== 'tareas') App.Tareas.abrir(); }
        else vacio();
      }
    } finally { aplicando = false; }
    marcarDetalle();
    pintarLista();
  }

  /* ---------------- módulos -> ruta ---------------- */
  function rutaDe(modo) {
    if (modo === 'agente') {
      var id = App.Agente.actual(), sid = App.Agente.sesionFija && App.Agente.sesionFija(), p = App.Agente.pestana();
      if (p !== 'chat') return '#/equipo/' + encodeURIComponent(id || '') + '/' + p;
      return '#/equipo/' + encodeURIComponent(id || '') + (sid ? '/' + sid : '');
    }
    if (modo === 'reunion') return '#/reuniones/' + encodeURIComponent((App.Reunion.abierta && App.Reunion.abierta()) || '');
    if (modo === 'entregables') { var e = App.Entregables.abierta(); return '#/bandeja/revisar' + (e ? '/' + e : ''); }
    if (modo === 'permisos') return '#/bandeja/permisos';
    if (modo === 'parte') return '#/bandeja/hoy';
    if (modo === 'departamentos') return '#/equipo/departamentos';
    if (modo === 'contratar') return '#/equipo/contratar';
    if (modo === 'creador') return '#/equipo/creador';
    if (modo === 'reunion-nueva') return '#/equipo/nueva-reunion';
    if (modo === 'flujos-editor') { var fe = App.Flujos.editando && App.Flujos.editando(); return '#/trabajo/flujos/editar' + (fe ? '/' + encodeURIComponent(fe) : ''); }
    if (modo === 'biblioteca') return '#/archivos/biblioteca';
    if (modo === 'conocimiento') return '#/archivos/conocimiento';
    if (modo === 'carpeta') { var c = App.Carpeta.ruta(); return '#/archivos/carpeta' + (c ? '/' + c.split('/').map(encodeURIComponent).join('/') : ''); }
    if (modo === 'tareas') return '#/trabajo/tareas';
    if (modo === 'flujos') { var co = App.Flujos.corridaAbierta && App.Flujos.corridaAbierta(); return '#/trabajo/flujos' + (co ? '/' + co : ''); }
    return '#/oficina';
  }
  /* App.abrirDerecho avisa acá: si el módulo se abrió desde otro lado, la sección y la ruta lo siguen */
  function alAbrir(modo) {
    if (modo !== 'agente') App.dom.derecho.classList.remove('con-relacionado', 'lado-movil');
    var lugar = lugarDe(modo);
    if (!lugar) return;
    if (seccion !== lugar[0] || (lugar[1] && sub !== lugar[1])) ponerSeccion(lugar[0], lugar[1]);
    if (!aplicando) empujar(rutaDe(modo));
    marcarDetalle();
    pintarLista();
  }
  /* App.cerrarDerecho avisa acá: en una sección, cerrar el panel vuelve a la lista (en el celular) o al vacío */
  function alCerrar(silencioso) {
    if (seccion === 'oficina' || silencioso) { marcarDetalle(); return; }
    vacio();
    if (!aplicando) empujar('#/' + seccion);
    pintarLista();
  }
  /* un módulo cambió algo que mira la lista (mandaste un mensaje, terminó una reunión…) */
  var refrescoPendiente = null;
  function refrescar() {
    sesiones = seccion === 'equipo' ? sesiones : null;
    clearTimeout(refrescoPendiente);
    refrescoPendiente = setTimeout(function () {
      if (seccion === 'equipo') { cargarSesiones().then(function () { if (App.Agente.repintarLado) App.Agente.repintarLado('charlas'); }); cargarReuniones(); } else pintarLista();
    }, 150);
  }

  function ir(ruta) { if (App.dom && App.dom.app) App.dom.app.classList.remove('lista-ver'); if (location.hash === ruta) aplicar(); else location.hash = ruta; }

  /* ---------------- columna de lista ---------------- */
  function lista() { return App.dom.lista; }
  function pintarLista() {
    var col = lista(); if (!col) return;
    if (seccion === 'bandeja') pintarBandeja(col);
    else if (seccion === 'equipo') pintarEquipo(col);
    else if (seccion === 'archivos') pintarArchivos(col);
    else if (seccion === 'trabajo') pintarTrabajo(col);
    else App.vaciar(col);
  }
  function cabecera(titulo, boton) { return h('div.lista-cab', h('h2', titulo), boton || null); }
  function filtroFila(icono, texto, activo, accion, extra) {
    return h('button.lista-filtro' + (activo ? '.activo' : ''), { onclick: accion }, typeof icono === 'string' ? App.icono(icono) : icono, h('span', texto), extra || null);
  }
  function grupoPlegable(clave, titulo, cuerpo, cuenta) {
    var abierto = !plegado[clave];
    var tit = h('button.lista-grupo.plegable' + (abierto ? '.abierto' : ''), { onclick: function () {
      plegado[clave] = abierto; abierto = !abierto;
      try { localStorage.setItem('oficina.nav.plegado', JSON.stringify(plegado)); } catch (e) {}
      tit.classList.toggle('abierto', abierto); cuerpo.classList.toggle('oculto', !abierto);
    } }, App.icono('abajo'), titulo, cuenta ? h('span.cuenta', cuenta) : null);
    cuerpo.classList.toggle('oculto', !abierto);
    return [tit, cuerpo];
  }

  /* --- charlas guardadas de todos (la más reciente primero): las usa el costado de cada charla --- */
  /* charlas que empezaste en este navegador y el servidor todavía no listó (le escribiste a una charla nueva y el agente
     sigue respondiendo, o el pedido todavía no salió): quedan en la lista hasta que /api/sesiones las traiga, así no
     desaparecen si te vas a otra charla antes de que termine. */
  var pendientes = {};
  function conPendientes(lista) {
    var hay = {};
    lista.forEach(function (s) { hay[s.session] = true; delete pendientes[s.session]; });
    var extra = Object.keys(pendientes).map(function (k) { return pendientes[k]; }).filter(function (s) { return !hay[s.session]; });
    return extra.length ? extra.concat(lista).sort(function (x, y) { return y.ts - x.ts; }) : lista;
  }
  function cargarSesiones() {
    return api().get('/api/sesiones').then(function (r) {
      sesiones = conPendientes(r.sesiones || []);
      return sesiones;
    }).catch(function () { sesiones = sesiones || conPendientes([]); });
  }
  /* mandaste un mensaje: si es la primera de esa charla, va a la lista ya (con tu mensaje de título) */
  function anotarCharla(agente, sid, texto) {
    if (!sid || (sesiones || []).some(function (s) { return s.session === sid; })) return;
    var t = (texto || '').replace(/\s+/g, ' ').trim();
    var s = { session: sid, agente: agente, titulo: t, ultimo: t, de: 'u', ts: Date.now() / 1000, n: 1 };
    pendientes[sid] = s;
    if (sesiones) sesiones.unshift(s);
  }
  function titulo(s) {
    var t = App.Adjuntos && App.Adjuntos.separar ? App.Adjuntos.separar(s.titulo || '').texto : s.titulo;
    return (t || '').trim() || 'Charla con archivos';
  }
  function corto(ts) {
    var d = Date.now() / 1000 - ts;
    if (d < 60) return 'recién';
    if (d < 3600) return Math.round(d / 60) + ' min';
    if (d < 86400) return Math.round(d / 3600) + ' h';
    return Math.round(d / 86400) + ' d';
  }
  function elegirAgente(ancla, alElegir, titulo) {
    var items = [{ titulo: titulo || 'Charlar con' }];
    (App.E.oficina.agentes || []).forEach(function (a) { items.push({ texto: a.nombre, nota: a.rol, retrato: a, accion: function () { alElegir(a.id); } }); });
    if (items.length === 1) { ir('#/equipo/contratar'); return; }
    App.menu(ancla, items);
  }
  function nuevaCharla(id) { App.Agente.nueva(id); }

  /* --- Reuniones: la lista de siempre, a la izquierda --- */
  function cargarReuniones() {
    return api().get('/api/reuniones').then(function (r) { reuniones = r.reuniones || []; if (seccion === 'equipo' && eqTab === 'reuniones') pintarLista(); }).catch(function () { reuniones = reuniones || []; });
  }
  /* Pestaña «Reuniones» de Equipo: llamar a una, las que están en curso y las terminadas. La búsqueda las filtra. */
  function listaReuniones(q) {
    var caja = h('div');
    var abierta = App.modoDerecho() === 'reunion' ? App.Reunion.abierta() : null;
    if (reuniones && abierta && !reuniones.some(function (x) { return x.id === abierta; })) cargarReuniones();   // recién creada
    if (!reuniones) { cargarReuniones(); caja.appendChild(App.cargando('Trayendo las reuniones…')); return caja; }
    var rs = reuniones.filter(function (x) { return !q || ((x.titulo || '') + ' ' + (x.tema || '') + ' ' + nombresDe(x).join(' ')).toLowerCase().indexOf(q) >= 0; });
    var vivas = rs.filter(function (x) { return x.estado !== 'cerrada'; });
    var cerradas = rs.filter(function (x) { return x.estado === 'cerrada'; });
    function fila(x) {
      var est = x.estado === 'cerrada' ? h('small', App.fecha(x.creada)) : h('span.insignia.ok', x.estado === 'en_curso' ? 'En curso' : 'Esperando');
      return h('div.lista-item' + (abierta === x.id ? '.activo' : ''), { onclick: function () { ir('#/reuniones/' + encodeURIComponent(x.id)); } },
        h('div.lista-icono', App.icono('reunion')),
        h('div.lista-item-txt', h('div.lista-item-tit', h('b', x.titulo || x.tema), est), h('div.lista-item-sub', nombresDe(x).join(', '))));
    }
    if (vivas.length) App.add(caja, h('div.lista-grupo', 'En curso', h('span.cuenta', vivas.length)), vivas.map(fila));
    if (cerradas.length) App.add(caja, h('div.lista-grupo', 'Terminadas', h('span.cuenta', cerradas.length)), cerradas.map(fila));
    if (!rs.length) caja.appendChild(h('div.vacio', q ? 'Nada con «' + q + '».' : 'Todavía no hubo reuniones.'));
    return caja;
  }
  function nombresDe(x) { return (x.agentes || []).map(function (id) { var a = App.agente(id); return a ? a.nombre : id; }); }
  /* «Nueva»: una charla con alguien o una reunión */
  function menuNueva(ancla) {
    var items = [{ titulo: 'Charlar con' }];
    (App.E.oficina.agentes || []).forEach(function (a) { items.push({ texto: a.nombre, nota: a.rol, retrato: a, accion: function () { nuevaCharla(a.id); } }); });
    items.push('-');
    items.push({ texto: 'Llamar a reunión…', icono: 'reunion', accion: function () { App.Reunion.nueva(); } });
    if ((App.E.oficina.agentes || []).length === 0) items = [{ texto: 'Contratar un agente…', icono: 'mas', accion: function () { ir('#/equipo/contratar'); } }];
    App.menu(ancla, items);
  }

  /* --- Bandeja: lo que te espera --- */
  function pintarBandeja(col) {
    var n = App.Entregables && App.Entregables.sinRevisar ? App.Entregables.sinRevisar() : 0;
    var np = App.Permisos && App.Permisos.cuantos ? App.Permisos.cuantos() : 0;
    App.add(App.vaciar(col), cabecera('Bandeja'), h('div.lista-cuerpo',
      filtroFila('parte', 'Hoy', sub === 'hoy', function () { ir('#/bandeja/hoy'); }, n + np ? h('span.insignia.aviso', n + np) : null),
      h('div.lista-grupo', 'Por tipo'),
      filtroFila('bandeja', 'Para revisar', sub === 'revisar', function () { ir('#/bandeja/revisar'); }, n ? h('span.insignia', n) : null),
      filtroFila('escudo', 'Te piden permiso', sub === 'permisos', function () { ir('#/bandeja/permisos'); }, np ? h('span.insignia', np) : null)));
  }

  /* --- Equipo: como un chat. Pestaña «Personas» (vos, los agentes por departamento y los departamentos: tocar a alguien
     abre su charla) y pestaña «Reuniones». Separadas para que con mucha gente las reuniones no queden al fondo. --- */
  var buscarEq = '';
  function pintarEquipo(col) {
    var vivas = (reuniones || []).filter(function (x) { return x.estado !== 'cerrada'; }).length;
    if (!reuniones) cargarReuniones();
    function pest(id, texto, extra) {
      return h('button', { role: 'tab', 'aria-selected': String(eqTab === id), onclick: function () {
        if (eqTab === id) return; eqTab = id; buscarEq = '';
        if (seccion === 'equipo' && (!App.modoDerecho() || App.modoDerecho() === 'vacio')) vacio();
        pintarLista();
      } }, texto, extra);
    }
    var inp = h('input.campo', { placeholder: 'Buscar', value: buscarEq, 'aria-label': 'Buscar' });
    var cuerpo = h('div.lista-cuerpo');
    function llenar() {
      var q = buscarEq.trim().toLowerCase();
      App.vaciar(cuerpo);
      if (eqTab === 'reuniones') { cuerpo.appendChild(listaReuniones(q)); return; }
      var nDeps = (App.E.oficina.departamentos || []).length;
      var grupoOficina = h('div.lista-grupo', 'La oficina', h('span.cuenta', nDeps + ' ' + (nDeps === 1 ? 'departamento' : 'departamentos')),
        h('button.btn.icono.chico', { title: 'Nuevo departamento', 'aria-label': 'Nuevo departamento', onclick: function () { App.Departamentos.agregar(); } }, App.icono('mas')));
      App.add(cuerpo, App.dom.equipo, grupoOficina,
        filtroFila('capas', 'Departamentos', sub === 'departamentos', function () { ir('#/equipo/departamentos'); }));
      /* filtrar a la gente sin rearmar la lista (las filas las pinta app.js) */
      App.dom.equipo.querySelectorAll('.persona[data-id]').forEach(function (el) {
        var a = App.agente(el.getAttribute('data-id'));
        el.classList.toggle('oculto', !!q && !!a && (a.nombre + ' ' + (a.rol || '')).toLowerCase().indexOf(q) < 0);
      });
      App.dom.equipo.querySelectorAll('.grupo-tit').forEach(function (g) {
        var n = g.nextElementSibling, alguno = false;
        while (n && n.classList.contains('persona')) { if (!n.classList.contains('oculto')) alguno = true; n = n.nextElementSibling; }
        g.classList.toggle('oculto', !!q && !alguno);
      });
    }
    inp.addEventListener('input', function () { buscarEq = inp.value; llenar(); });
    llenar();
    var accion = eqTab === 'reuniones'
      ? h('button.btn.chico', { title: 'Llamar a una reunión', onclick: function () { App.Reunion.nueva(); } }, App.icono('mas'), 'Nueva reunión')
      : h('button.btn.chico', { title: 'Contratar un agente', onclick: function () { ir('#/equipo/contratar'); } }, App.icono('mas'), 'Contratar');
    App.add(App.vaciar(col),
      h('div.eq-tabs.eq-tabs-tope', { role: 'tablist' },
        pest('personas', 'Personas', h('em', String((App.E.oficina.agentes || []).length))),
        pest('reuniones', 'Reuniones', vivas ? h('span.en-curso', { title: vivas === 1 ? 'Una en curso' : vivas + ' en curso' }, h('i.vivo-p'), String(vivas)) : h('em', String((reuniones || []).length || '')))),
      h('div.eq-fila', h('div.lista-buscar', App.icono('buscar'), inp), accion), cuerpo);
    if (App.marcarEstados) App.marcarEstados();
  }
  /* Departamentos como pantalla (la misma sección de Ajustes): al guardar se vuelve a pintar */
  function abrirDepartamentos() {
    App.Departamentos.abrir(function (op) {
      var hj = App.hojaEnPanel({ titulo: op.titulo || 'Departamentos', icono: 'capas' }, 'departamentos');
      hj.enVentana = true;
      var barra = h('div.acciones'); hj.pie.appendChild(barra); hj.pie = barra;   // los botones van en la barra, no estirados
      hj.cerrar = function () { if (App.modoDerecho() === 'departamentos') abrirDepartamentos(); };
      return hj;
    });
  }

  /* --- Archivos: la carpeta, la biblioteca y el conocimiento --- */
  function pintarArchivos(col) {
    var d = App.dom;
    App.add(App.vaciar(col), cabecera('Archivos'), h('div.lista-cuerpo',
      filtroFila('carpeta', 'Carpeta de la oficina', sub === 'carpeta', function () { ir('#/archivos/carpeta'); }),
      filtroFila('libro', 'Biblioteca', sub === 'biblioteca', function () { ir('#/archivos/biblioteca'); }, d.navBib),
      filtroFila('bombilla', 'Conocimiento', sub === 'conocimiento', function () { ir('#/archivos/conocimiento'); }, d.navCon)));
  }

  /* --- Trabajo: tareas y flujos (los botones de «nuevo» viven en cada panel) --- */
  function pintarTrabajo(col) {
    var d = App.dom;
    App.add(App.vaciar(col), cabecera('Trabajo'), h('div.lista-cuerpo',
      filtroFila('reloj', 'Tareas', sub === 'tareas', function () { ir('#/trabajo/tareas'); }, d.navTar && d.navTar.textContent ? h('span.insignia', d.navTar.textContent) : null),
      filtroFila('flujo', 'Flujos', sub === 'flujos', function () { ir('#/trabajo/flujos'); }, d.navFlu)));
  }

  /* --- «Detalles»: la columna a la derecha de la charla (en la compu). Sus charlas arriba de todo, y sus tareas,
     archivos y notas: de cada cosa se ven las primeras y «Ver todas» abre la lista completa en esa misma columna
     (App.Agente.verLado), así la columna mide lo mismo con 3 cosas o con 300. --- */
  var MAX_LADO = 3;
  function charlasDe(id) { return (sesiones || []).filter(function (s) { return s.agente === id; }); }
  function filaCharla(id, s, activa) {
    return h('button.lat-fila.charla' + (activa ? '.act' : ''), { onclick: function () { ir('#/equipo/' + encodeURIComponent(id) + '/' + s.session); } },
      App.icono('charla'), h('span', h('b', titulo(s)), h('small', activa ? 'abierta ahora' : corto(s.ts))));
  }
  function relacionado(id) {
    var a = App.agente(id);
    var caja = h('div.lat-cuerpo');
    if (!a) return caja;
    function seccion_(titulo_, cuenta, mas, cuerpo, ver) {
      var tit = h('div.lat-sec-tit', h('span', titulo_), cuenta, mas || null);
      return h('section.lat-sec', tit, cuerpo, ver || h('span'));
    }
    function verTodas(cual, n, texto) { return n > MAX_LADO ? h('button.lat-mas', { onclick: function () { App.Agente.verLado(cual); } }, (texto || 'Ver todas') + ' (' + n + ')', App.icono('flecha')) : null; }
    function cuenta(n) { return h('em', n == null ? '' : String(n)); }
    /* «nuevo» de cada sección: con borde y texto (no un «+» suelto), todos iguales */
    var botonMas = function (texto, titulo_, accion) { return h('button.btn.chico.lat-nueva', { title: titulo_, onclick: accion }, App.icono('mas'), texto); };

    /* charlas */
    var charlas = h('div'), charlasVer = h('div'), charlasN = cuenta(null);
    function pintarCharlas_() {
      App.vaciar(charlas); App.vaciar(charlasVer);
      var actualSid = App.Agente.sesion(id), ss = charlasDe(id);
      charlasN.textContent = sesiones ? String(ss.length) : '';
      var actual = ss.filter(function (s) { return s.session === actualSid; })[0];
      if (!actual && App.Agente.actual() === id) charlas.appendChild(h('button.lat-fila.charla.act', App.icono('charla'), h('span', h('b', 'Charla nueva'), h('small', 'abierta ahora'))));
      var vis = ss.slice(0, MAX_LADO + 1);
      if (actual && vis.indexOf(actual) < 0) vis.push(actual);
      vis.forEach(function (s) { charlas.appendChild(filaCharla(id, s, s === actual)); });
      if (!ss.length && !charlas.children.length) charlas.appendChild(h('div.lat-vacio', sesiones ? 'Todavía no charlaron.' : '…'));
      var v = ss.length > MAX_LADO + 1 ? h('button.lat-mas', { onclick: function () { App.Agente.verLado('charlas'); } }, 'Ver todas (' + ss.length + ')', App.icono('flecha')) : null;
      if (v) charlasVer.appendChild(v);
    }
    if (sesiones) pintarCharlas_(); else cargarSesiones().then(pintarCharlas_);
    caja.appendChild(seccion_('Charlas', charlasN, botonMas('Nueva charla', 'Empezar de cero con ' + a.nombre + '. Esta charla queda guardada en la lista.', function () { App.Agente.nueva(id); }), charlas, charlasVer));

    /* carpetas de trabajo: dónde trabaja además de la oficina (solo si tiene alguna); llevan a Ajustes */
    var trabajo = ((App.E.oficina && App.E.oficina.carpetasTrabajo) || []).filter(function (c) {
      var al = c.alcance;
      return !al || al === 'oficina' || (al.agentes && al.agentes.indexOf(id) >= 0) || (al.departamentos && al.departamentos.indexOf(a.departamento) >= 0);
    });
    if (trabajo.length) {
      var aAjustes = function () { App.Ajustes.abrir('trabajo'); };
      caja.appendChild(seccion_('Trabaja en', cuenta(trabajo.length), null, h('div', trabajo.map(function (c) {
        return h('button.lat-fila', { title: c.ruta + ' · cambiar en Ajustes', onclick: aAjustes }, App.icono('carpeta'),
          h('span', h('b', App.humano.carpeta(c.ruta)), h('small', 'lee y escribe ahí')));
      }))));
    }

    /* tareas programadas */
    var tareas = h('div', h('div.lat-vacio', '…')), tareasN = cuenta(null), tareasVer = h('div');
    caja.appendChild(seccion_('Tareas', tareasN, botonMas('Nueva tarea', 'Nueva tarea para ' + a.nombre, function () { App.Agente.nuevaTarea(id, {}); }), tareas, tareasVer));
    api().get('/api/tareas').then(function (r) {
      App.vaciar(tareas);
      var ts = (r.tareas || []).filter(function (t) { return t.agente === id; });
      ts.sort(function (x, y) { return (y.activa !== false) - (x.activa !== false); });
      tareasN.textContent = String(ts.length);
      if (!ts.length) tareas.appendChild(h('div.lat-vacio', 'Sin tareas programadas.'));
      ts.slice(0, MAX_LADO).forEach(function (t) {
        tareas.appendChild(h('button.lat-fila', { onclick: function () { App.Agente.verLado('tareas'); } }, App.icono('reloj'),
          h('span', h('b', t.nombre), h('small', t.corriendo ? 'corriendo' : t.activa === false ? 'en pausa' : (t.unica ? 'una vez' : 'programada')))));
      });
      var v = verTodas('tareas', ts.length); if (v) tareasVer.appendChild(v);
    }).catch(function () { App.vaciar(tareas); });

    /* archivos que guardó */
    var archivos = h('div', h('div.lat-vacio', '…')), archivosN = cuenta(null), archivosVer = h('div');
    caja.appendChild(seccion_('Archivos', archivosN, null, archivos, archivosVer));
    api().get('/api/biblioteca/entregables', { agente: id }).then(function (r) {
      App.vaciar(archivos);
      var es = r.entregables || [];
      archivosN.textContent = String(es.length);
      if (!es.length) archivos.appendChild(h('div.lat-vacio', 'Lo que ' + a.nombre + ' guarde aparece acá.'));
      es.slice(0, MAX_LADO).forEach(function (x) {
        archivos.appendChild(h('button.lat-fila', { onclick: function () { api().get('/api/biblioteca/entregable', { agente: id, ruta: x.ruta }).then(App.abrirContenido).catch(App.fallo); } },
          App.icono('parte'), h('span', h('b', x.nombre), h('small', App.tam(x.tam || 0)))));
      });
      var v = verTodas('archivos', es.length, 'Ver todos'); if (v) archivosVer.appendChild(v);
    }).catch(function () { App.vaciar(archivos); });

    /* notas: lo que fue anotando (su conocimiento), en renglones */
    var notas = h('div', h('div.lat-vacio', '…')), notasN = cuenta(null), notasVer = h('div');
    caja.appendChild(seccion_('Notas', notasN, null, notas, notasVer));
    api().get('/api/agentes/' + encodeURIComponent(id) + '/conocimiento').then(function (r) {
      App.vaciar(notas);
      var renglones = (r.texto || '').split('\n').map(function (l) { return l.replace(/^\s*([-*+]|\d+\.|#+)\s*/, '').replace(/[*_`>]/g, '').trim(); }).filter(Boolean);
      notasN.textContent = String(renglones.length);
      if (!renglones.length) notas.appendChild(h('div.lat-vacio', 'Todavía no anotó nada.'));
      renglones.slice(0, MAX_LADO).forEach(function (l) { notas.appendChild(h('div.lat-nota', l)); });
      var v = verTodas('notas', renglones.length); if (v) notasVer.appendChild(v);
    }).catch(function () { App.vaciar(notas); });
    return caja;
  }
  /* cuántas charlas, tareas, archivos y notas tiene: alLlegar(clave, n) por cada una, a medida que llegan */
  function cuentas(id, alLlegar) {
    var charlas_ = function () { alLlegar('charlas', charlasDe(id).length); };
    if (sesiones) charlas_(); else cargarSesiones().then(charlas_);
    api().get('/api/tareas').then(function (r) { alLlegar('tareas', (r.tareas || []).filter(function (t) { return t.agente === id; }).length); }).catch(function () {});
    api().get('/api/biblioteca/entregables', { agente: id }).then(function (r) { alLlegar('archivos', (r.entregables || []).length); }).catch(function () {});
    api().get('/api/agentes/' + encodeURIComponent(id) + '/conocimiento').then(function (r) {
      alLlegar('notas', (r.texto || '').split('\n').map(function (l) { return l.replace(/^\s*([-*+]|\d+\.|#+)\s*/, '').replace(/[*_`>]/g, '').trim(); }).filter(Boolean).length);
    }).catch(function () {});
  }
  /* todas sus charlas, para «Ver todas» (con buscador) */
  function todasLasCharlas(id, q) {
    var caja = h('div'), actualSid = App.Agente.sesion(id);
    var ss = charlasDe(id).filter(function (s) { return !q || (titulo(s) + ' ' + (s.ultimo || '')).toLowerCase().indexOf(q) >= 0; });
    if (!sesiones) { cargarSesiones().then(function () { App.Agente.repintarLado('charlas'); }); caja.appendChild(h('div.lat-vacio', '…')); return caja; }
    ss.forEach(function (s) {
      var ult = App.Adjuntos && App.Adjuntos.separar ? App.Adjuntos.separar(s.ultimo || '').texto : s.ultimo;
      caja.appendChild(h('button.lat-fila.charla' + (s.session === actualSid ? '.act' : ''), { onclick: function () { App.Agente.verLado('detalles'); ir('#/equipo/' + encodeURIComponent(id) + '/' + s.session); } },
        App.icono('charla'), h('span', h('b', titulo(s)), h('small', (s.de === 'u' ? 'Vos: ' : '') + (ult || '').replace(/[*#`|>]/g, ''))), h('em.meta', corto(s.ts))));
    });
    if (!ss.length) caja.appendChild(h('div.lat-vacio', q ? 'Nada con «' + q + '».' : 'Todavía no charlaron.'));
    return caja;
  }
  function tituloCharla(id) {
    var sid = App.Agente.sesion(id), s = charlasDe(id).filter(function (x) { return x.session === sid; })[0];
    return s ? titulo(s) : 'Charla nueva';
  }

  /* ---------------- arranque ---------------- */
  window.addEventListener('hashchange', function () { if (App.dom && App.dom.app) aplicar(); });
  /* la lista desplegada sobre el panel se pliega al tocar fuera de ella */
  document.addEventListener('pointerdown', function (e) {
    var app = App.dom && App.dom.app;
    if (app && app.classList.contains('lista-ver') && !e.target.closest('.lista-col, .riel')) app.classList.remove('lista-ver');
  });
  window.addEventListener('popstate', function () { if (App.dom && App.dom.app) aplicar(); });
  document.addEventListener('keydown', function (e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || !/^[1-6]$/.test(e.key)) return;
    if (!App.dom || !App.dom.app || (App.hojaAbierta && App.hojaAbierta())) return;
    e.preventDefault();
    var s = SECCIONES[+e.key - 1];
    ir(s.id === 'oficina' ? s.ruta : rutaSeccion(s.id));
  });

  return {
    riel: riel, aplicar: aplicar, ir: ir, alAbrir: alAbrir, alCerrar: alCerrar, refrescar: refrescar, anotarCharla: anotarCharla,
    seccion: function () { return seccion; }, enSeccion: function () { return !!seccion && seccion !== 'oficina'; },
    nombreSeccion: function () { var s = SECCIONES.filter(function (x) { return x.id === seccion; })[0]; return s ? s.texto : ''; },
    pintarLista: pintarLista, elegirAgente: elegirAgente, relacionado: relacionado, menuNueva: menuNueva,
    todasLasCharlas: todasLasCharlas, tituloCharla: tituloCharla, acomodar: acomodar, cuentas: cuentas
  };
})();
