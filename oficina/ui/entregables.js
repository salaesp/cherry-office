/* Entregables (docs/plan-entregables.md, E2): lo que los agentes terminaron y te falta revisar.
   Panel derecho con la lista (filtro «sin revisar» por defecto, por agente y por origen) y el detalle de cada entrega
   (texto, archivos, «Listo», «Pedir cambios», «Abrir en el chat»). El contador llega con /api/actividad y se reparte a la
   barra lateral, al muro de la oficina, al Dock (junto con los avisos) y a la tecla N. Abrir una entrega NO la marca revisada. */
window.App = window.App || {};
App.Entregables = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var api = function () { return App.api; };
  var sinRevisar = 0, ultimas = [], firma = null;
  var filtro = { estado: 'sin_revisar', agente: '', origen: '' };
  var abierta = null;          // id de la entrega que muestra el panel (null = lista)
  var ORIGEN = { tarea: 'Tarea programada', encargo: 'Pendiente de reunión', reunion: 'Acta de reunión', chat: 'Chat', cambios: 'Con cambios',
    flujo: 'Paso de un flujo', persona: 'Hecho por vos', propuesta: 'Propuesta', accion: 'Acción aprobada', parte: 'Parte del día',
    pedido: 'Pedido de un colega', espera: 'Versión completa', secretaria: 'Reporte de la secretaría', importacion: 'Importación a la memoria' };
  var ESTADO = { sin_revisar: 'Sin revisar', revisada: 'Revisada', cambios: 'Reemplazada' };

  /* quién la hizo: en una entrega tuya (paso de persona) no hay agente */
  function nombreDe(e) { return e.origen === 'persona' && !e.agente ? 'Vos' : nombre(e.agente); }
  function nombre(id) { var a = id && App.agente(id); return a ? a.nombre : (id ? App.humano.quien(id) : 'Reunión'); }
  function origenTxt(o) { return ORIGEN[o] || 'Otro origen'; }
  function hace(iso) {
    var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'recién';
    if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
    return 'hace ' + Math.round(s / 86400) + ' d';
  }
  function abiertoPanel() { return App.modoDerecho && App.modoDerecho() === 'entregables'; }

  /* ---------------- contador (con cada /api/actividad) ---------------- */
  function alActividad(r) {
    var n = r.entregasSinRevisar | 0;
    if (n === sinRevisar && firma !== null) return;
    sinRevisar = n;
    refrescarUltimas();
    if (abiertoPanel() && abierta === null) pintarLista();
  }

  function refrescarUltimas() {
    return api().get('/api/entregas', { limite: 8 }).then(function (r) {
      ultimas = r.entregas || []; sinRevisar = r.sinRevisar | 0;
      firma = JSON.stringify(ultimas.map(function (e) { return e.id + e.estado; })) + sinRevisar;
      pintarContador();
    }).catch(function () { /* se reintenta con la próxima actividad */ });
  }

  function pintarContador() {
    var b = App.dom && App.dom.navEnt;
    if (b) { b.textContent = sinRevisar; b.classList.toggle('oculto', !sinRevisar); }
    if (App.Oficina && App.Oficina.muro) App.Oficina.muro(ultimas, sinRevisar);
    if (App.Avisos && App.Avisos.insignia) App.Avisos.insignia();
    if (App.Yo && App.Yo.refrescar) App.Yo.refrescar();
    if (App.Nav && App.Nav.seccion() === 'bandeja') App.Nav.pintarLista();
  }

  /* ---------------- panel: lista ---------------- */
  function abrir(id) {
    if (App.Agente && App.Agente.alCerrar) App.Agente.alCerrar();
    abierta = id ? +id : null;   // antes de abrir: la ruta lleva la entrega
    App.abrirDerecho('entregables');
    if (id) verEntrega(+id); else pintarLista();
  }

  function cabecera(titulo, sub, volver, icono) {
    return App.cabPanel({ icono: icono || 'bandeja', titulo: titulo, sub: sub, volver: volver });
  }

  function pintarLista() {
    if (!abiertoPanel()) return;
    if (abierta !== null) { abierta = null; App.Nav.alAbrir('entregables'); }
    var der = App.dom.derecho, cuerpo = h('div.der-cuerpo'), lista = h('div.entregas', App.cargando('Trayendo las entregas…'));
    var o = App.E.oficina || { agentes: [] };
    var porEstado = App.elegir({ forma: 'chips', etiqueta: 'Estado', valor: filtro.estado,
      opciones: [{ valor: 'sin_revisar', titulo: 'Sin revisar' + (sinRevisar ? ' (' + sinRevisar + ')' : '') }, { valor: '', titulo: 'Todas' }],
      alCambiar: function (v) { filtro.estado = v; pintarLista(); } });
    /* origen: un menú «Filtrar» (son once y no hacen falta a la vista) */
    var botonOrigen = h('button.chip' + (filtro.origen ? '.sel' : ''), { type: 'button', onclick: function (ev) {
      App.menu(ev.currentTarget, [{ texto: 'Cualquier origen', accion: function () { filtro.origen = ''; pintarLista(); } }]
        .concat(Object.keys(ORIGEN).map(function (k) { return { texto: ORIGEN[k], accion: function () { filtro.origen = k; pintarLista(); } }; })));
    } }, App.icono('deslizadores'), filtro.origen ? origenTxt(filtro.origen) : 'Filtrar');
    /* de quién: chips con el retrato de cada agente */
    var porAgente = App.elegir({ forma: 'chips', etiqueta: 'De quién', valor: filtro.agente,
      opciones: [{ valor: '', titulo: 'De todos' }, { valor: '__reunion', titulo: 'Actas de reunión', icono: 'reunion' }]
        .concat(o.agentes.map(function (a) { return { valor: a.id, titulo: a.nombre, retrato: a }; })),
      alCambiar: function (v) { filtro.agente = v; pintarLista(); } });
    App.add(App.vaciar(der),
      cabecera('Para revisar', sinRevisar ? (sinRevisar === 1 ? '1 sin revisar' : sinRevisar + ' sin revisar') : 'Todo revisado'),
      cuerpo);
    App.add(cuerpo,
      h('div.entregas-filtros', porEstado, botonOrigen),
      h('div.entregas-filtros', porAgente),
      lista);
    var q = { limite: 100 };
    if (filtro.estado) q.estado = filtro.estado;
    if (filtro.origen) q.origen = filtro.origen;
    if (filtro.agente && filtro.agente !== '__reunion') q.agente = filtro.agente;
    api().get('/api/entregas', q).then(function (r) {
      App.vaciar(lista);
      var es = (r.entregas || []).filter(function (e) { return filtro.agente !== '__reunion' || !e.agente; });
      if (!es.length) {
        lista.appendChild(filtro.estado === 'sin_revisar'
          ? App.vacio('ok', 'Nada para revisar', 'Cuando un agente termine una tarea o un encargo, aparece acá.',
            [h('button.btn', { onclick: function () { filtro.estado = 'todas'; pintarLista(); } }, 'Ver lo ya revisado')])
          : h('div.vacio', 'Todavía no hay entregas con ese filtro.'));
        return;
      }
      es.forEach(function (e) { lista.appendChild(fila(e)); });
    }).catch(function (e) { App.vaciar(lista).appendChild(h('div.error-txt', e.message)); });
  }

  function marcaAgente(e) {
    var a = e.agente && App.agente(e.agente), d = a && App.depto(a.departamento);
    if (!a && (e.origen === 'persona' || e.origen === 'propuesta' || e.origen === 'accion' || e.origen === 'parte' || e.origen === 'flujo')) {
      return h('div.retrato', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel-2)', color: 'var(--suave)', border: '1px solid var(--linea)' } }, App.icono(e.origen === 'flujo' ? 'flujo' : 'libro'));
    }
    return a ? App.retratoImg(a, 'retrato', 64) : h('div.retrato', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: d ? d.color : '#0a5fb4' } }, App.icono('reunion'));
  }

  function fila(e) {
    var est = e.estado === 'sin_revisar' ? h('span.insignia.aviso', 'Sin revisar') : e.estado === 'revisada' ? h('span.insignia.ok', 'Revisada') : h('span.insignia', 'Reemplazada');
    return h('button.entrega-fila' + (e.estado === 'sin_revisar' ? '.nueva' : ''), { onclick: function () { verEntrega(e.id); } },
      marcaAgente(e),
      h('div.entrega-txt',
        h('div.entrega-tit', e.titulo),
        h('div.entrega-sub', nombreDe(e) + ' · ' + origenTxt(e.origen) + ' · ' + hace(e.creada) +
          (e.archivos && e.archivos.length ? ' · ' + e.archivos.length + (e.archivos.length === 1 ? ' archivo' : ' archivos') : '')),
        e.resumen ? h('div.entrega-res', e.resumen) : null),
      est);
  }

  /* ---------------- panel: detalle ---------------- */
  function verEntrega(id) {
    var cambio = abierta !== id;
    abierta = id;
    if (!abiertoPanel()) App.abrirDerecho('entregables'); else if (cambio) App.Nav.alAbrir('entregables');
    var der = App.dom.derecho;
    App.vaciar(der).appendChild(App.cargando('Trayendo la entrega…'));
    api().get('/api/entregas/' + id).then(function (r) { if (abierta === id) pintarDetalle(r.entrega); })
      .catch(function (e) { App.fallo(e); pintarLista(); });
  }

  function linkOrigen(e) {
    /* solo los encargos `encargo:<reunión>:<n>` vienen de una reunión (los `coord:xxxx` del coordinador no) */
    var reu = e.origen === 'reunion' ? e.ref : (e.origen === 'encargo' && e.ref.indexOf('encargo:') === 0 ? (e.ref.split(':')[1] || '') : '');
    if (reu && App.Reunion && App.Reunion.ver) return h('button.btn.chico.fantasma', { onclick: function () { App.Reunion.ver(reu); } }, App.icono('reunion'), 'Ver la reunión');
    if (e.origen === 'tarea' && e.agente) return h('button.btn.chico.fantasma', { onclick: function () { App.Agente.abrir(e.agente, 'tareas'); } }, 'Ver la tarea');
    return null;
  }

  /* el nombre del archivo; si dos se llaman igual, con la carpeta que los distingue */
  function nombreCorto(rel, todos) {
    var n = rel.split('/').pop();
    var iguales = todos.filter(function (x) { return x.split('/').pop() === n; }).length > 1;
    return iguales ? rel.split('/').slice(-2).join('/') : n;
  }

  /* la carpeta de los archivos de una entrega: en la app, el Finder; en el navegador, Archivos › Carpeta de la oficina ahí */
  function mostrarCarpeta(rel) {
    if (App.nativo.hay && App.E.carpeta) { App.nativo.revelar(App.E.carpeta.replace(/\/$/, '') + (rel ? '/' + rel : '')); return; }
    App.Nav.ir('#/archivos/carpeta' + (rel ? '/' + rel.split('/').map(encodeURIComponent).join('/') : ''));
  }

  function abrirArchivo(rel, e) {
    if (e && App.Revisar && App.Revisar.tipo(rel) !== 'otro') { revisar(e, rel); return; }
    App.abrirArchivoOficina(rel);
  }

  function pintarDetalle(e) {
    if (!abiertoPanel() || abierta !== e.id) return;
    var der = App.dom.derecho, cuerpo = h('div.der-cuerpo'), pie = h('div.der-pie');
    var bloqueAccion = h('div'), bloqueEspera = h('div');
    var volver = { texto: 'Para revisar', titulo: 'Volver a la lista', accion: function () { App.Nav.ir('#/bandeja/revisar'); } };
    var sub = nombreDe(e) + ' · ' + origenTxt(e.origen) + ' · ' + hace(e.creada) + (typeof e.costo === 'number' && e.costo > 0 ? ' · ≈ US$ ' + e.costo.toFixed(2) : '');
    App.add(App.vaciar(der), cabecera(e.titulo, sub, volver, e.origen === 'reunion' ? 'reunion' : 'libro'), cuerpo, pie);
    var est = e.estado === 'sin_revisar' ? h('span.insignia.aviso', 'Sin revisar') : e.estado === 'revisada' ? h('span.insignia.ok', 'Revisada') : h('span.insignia', 'Reemplazada por una versión nueva');
    var meta = h('div.entrega-meta', est, e.padre ? h('span.insignia', 'Versión con cambios') : null, linkOrigen(e));
    App.add(cuerpo, meta, bloqueEspera, bloqueAccion);
    /* una tarea que salió de una charla: «Salió de un chat con…», que abre esa charla */
    if (e.origen === 'tarea' && e.ref) api().get('/api/tareas/' + encodeURIComponent(e.ref)).then(function (r) {
      var t = r.tarea;
      if (!t || !t.charla || !t.origen || !t.origen.chat || abierta !== e.id) return;
      meta.appendChild(h('button.btn.chico.fantasma', { title: 'Abrir la charla de la que salió esta tarea', onclick: function () { App.Agente.abrirSesion(t.charla.agente, t.origen.chat); } },
        App.icono('charla'), 'Salió de un chat con ' + t.charla.nombre));
    }).catch(function () { /* la tarea ya no está: sin enlace */ });
    if (e.enCambios) {
      App.add(cuerpo, h('div.entrega-meta', h('span.insignia.aviso', h('span.giro'), ' ' + nombre(e.agente) + ' está haciendo los cambios…')));
      vigilarCambios(e.id);
    }
    if (e.archivos && e.archivos.length) {
      /* archivos como chips con el nombre (la ruta va en el title) y, a la derecha, dónde quedaron */
      var carpeta = e.archivos[0].split('/').slice(0, -1).join('/');
      App.add(cuerpo, h('div.entrega-archivos',
        h('div.entrega-archivos-cab', h('span.etiqueta-campo', e.archivos.length === 1 ? 'Archivo' : e.archivos.length + ' archivos'),
          h('div.acciones-chicas',
            App.Revisar && App.Revisar.conVista(e).length ? h('button.btn.chico', { title: 'Ver los archivos tal cual quedan y marcar qué cambiar', onclick: function () { revisar(e); } },
              App.icono('lapiz'), App.Revisar.cuantasNotas(e) ? 'Revisar (' + App.Revisar.cuantasNotas(e) + ' notas)' : 'Revisar') : null,
            h('button.btn.chico.fantasma', { title: carpeta || 'Carpeta de la oficina', onclick: function () { mostrarCarpeta(carpeta); } }, App.icono('carpeta'),
              App.nativo.hay ? 'Mostrar ' + App.nativo.enExplorador : 'Ver la carpeta'))),
        h('div.adjuntos', e.archivos.map(function (rel) {
          var guardado = enBiblioteca(e, rel);
          return h('span.entrega-archivo',
            h('button.adjunto', { onclick: function () { abrirArchivo(rel, e); }, title: rel }, App.icono(App.esMarkdown(rel) ? 'libro' : 'abrir'), h('span', nombreCorto(rel, e.archivos))),
            guardado && App.Biblioteca ? h('button.insignia.ok.insignia-link', { title: 'Ver la copia en la biblioteca', onclick: function () { App.Biblioteca.abrir(guardado.slug); } },
              App.icono('libro'), 'En la biblioteca') : null);
        }))));
    }
    if (e.retoques && e.retoques.length) meta.appendChild(h('span.insignia', { title: 'Cambiaste algo a mano después de que lo entregó' }, App.icono('lapiz'), 'Retocada a mano'));
    /* la versión con cambios: lo que pediste con notas sobre la anterior */
    var pediste = h('div');
    App.add(cuerpo, pediste);
    if (e.padre) api().get('/api/entregas/' + e.padre).then(function (r) {
      var notas = (r.entrega && r.entrega.notas) || [];
      if (!notas.length || abierta !== e.id) return;
      App.add(pediste, h('div.entrega-pediste', h('b', 'Lo que pediste'), h('ol', notas.map(function (n) {
        var a = n.ancla || {};
        return h('li', a.cita ? h('span.suave', '«' + a.cita + '»: ') : null, n.texto);
      }))));
    }).catch(function () { /* sin la anterior: no se muestra */ });
    App.add(cuerpo, App.htmlSeguro(h('div.md-doc.doc-panel.entrega-texto'), App.markdown(e.texto || '(sin texto)')));
    /* flujo y acción llegan aparte: hasta entonces el pie queda vacío, para no ofrecer «Listo» sobre una propuesta sin resolver */
    var extra = { corrida: null, accion: null };
    Promise.all([
      api().get('/api/flujos/corridas', { entrega: e.id, estado: 'todas' }).then(function (r) { return (r.corridas || [])[0] || null; }).catch(function () { return null; }),
      api().get('/api/acciones', { entrega: e.id }).then(function (r) { return r.accion || null; }).catch(function () { return null; }),
      api().get('/api/esperas', { entrega: e.id, estado: 'todas' }).then(function (r) { return r.esperas || []; }).catch(function () { return []; })
    ]).then(function (r) {
      if (!abiertoPanel() || abierta !== e.id) return;
      extra.corrida = r[0]; extra.accion = r[1];
      pintarEspera(e, r[2], bloqueEspera);
      if (extra.corrida) {
        var c = extra.corrida;
        meta.appendChild(h('button.insignia.info.insignia-link', { title: 'Ver el flujo', onclick: function () { if (App.Flujos && App.Flujos.verCorrida) App.Flujos.verCorrida(c.id); } },
          App.icono('flujo'), 'Flujo · ' + (c.pasoNombre || ('paso ' + (c.paso + 1)))));
      }
      pintarAccion(e, extra.accion, bloqueAccion);
      pintarPie(e, extra, pie);
      if (extra.accion && extra.accion.estado === 'ejecutando') vigilarAccion(e.id);
    });
  }

  /* ---------------- esperas entre agentes (docs/plan-dependencias.md) ---------------- */
  function despuesDeEspera(e, msg) {
    if (msg) App.aviso(msg);
    refrescarUltimas(); if (App.Actividad) App.Actividad.ya();
    verEntrega(e.id);
  }

  /* una v1 con espera abierta: a quién espera y qué se puede hacer; una v2: de qué colega llegó lo que faltaba */
  function pintarEspera(e, esperas, caja) {
    App.vaciar(caja);
    var filas = [], pendientes = [];
    (esperas || []).forEach(function (x) {
      if (x.entregaParcial === e.id && (x.estado === 'esperando' || x.estado === 'lista' || x.estado === 'relanzada' || x.estado === 'fallida')) {
        var pedidoFallo = x.pedido && x.pedido.estado === 'fallido' && x.estado === 'esperando';
        var titulo = x.estado === 'esperando' ? 'Espera a ' + x.esperaANombre
          : x.estado === 'lista' ? 'Ya llegó lo de ' + x.esperaANombre
          : x.estado === 'relanzada' ? x.agenteNombre + ' rehace la versión completa'
          : 'No se pudo hacer la versión completa';
        var sub = x.estado === 'esperando' ? x.que + ' · ' + hace(x.creada) + (x.vencida ? ' · ya pasó el plazo' : '') + (pedidoFallo ? ' · el pedido falló' : '')
          : x.estado === 'lista' ? '«' + x.que + '»: ' + x.agenteNombre + ' va a rehacer la versión completa.'
          : x.estado === 'relanzada' ? 'Con lo de ' + x.esperaANombre + '…'
          : (x.motivo || 'Probá de nuevo.');
        var seguir = { texto: 'Seguir sin esperar', accion: function () {
          api().post('/api/esperas/' + x.id + '/seguir').then(function () { despuesDeEspera(e, 'Listo: ' + x.agenteNombre + ' sigue sin esperar.'); }).catch(App.fallo);
        } };
        var cancelar = { texto: 'Cancelar la espera', icono: 'cerrar', accion: function () {
          api().post('/api/esperas/' + x.id + '/cancelar').then(function () { despuesDeEspera(e, 'Espera cancelada.'); }).catch(App.fallo);
        } };
        var reintentar = { texto: pedidoFallo ? 'Reintentar el pedido' : 'Reintentar', accion: function () {
          api().post('/api/esperas/' + x.id + '/reintentar').then(function () { despuesDeEspera(e, pedidoFallo ? 'Se volvió a lanzar el pedido.' : 'Se vuelve a intentar.'); }).catch(App.fallo);
        } };
        var acc = [];
        if (pedidoFallo || x.estado === 'fallida') acc.push(reintentar);
        if (x.estado === 'esperando' || x.estado === 'lista') acc.push(seguir, cancelar);
        var principal = acc[0] ? h('button.btn.chico', { onclick: function () { acc[0].accion(); } }, acc[0].texto) : null;
        var a = x.esperaA && App.agente(x.esperaA);
        pendientes.push(App.filaDecision({ marca: a || 'reloj', titulo: titulo, sub: sub, principal: principal, mas: acc.slice(1) }));
      }
      if (x.entregaParcial === e.id && x.estado === 'hecha' && x.entregaNueva && x.entregaNueva !== e.id) {
        filas.push(h('div.entrega-accion', h('h4', 'Ya está la versión completa'), h('div.acc-res', 'Llegó lo de ' + x.esperaANombre + ' y ' + x.agenteNombre + ' rehízo esta entrega.'),
          h('div', h('button.btn.chico', { onclick: function () { verEntrega(x.entregaNueva); } }, 'Ver la versión completa'))));
      }
      if (x.entregaNueva === e.id) {
        filas.push(h('div.entrega-accion', h('h4', 'Versión completa'), h('div.acc-res', 'Llegó lo de ' + x.esperaANombre + ' («' + x.que + '») y esta es la versión completa.'),
          x.entregaLlegada ? h('div', h('button.btn.chico.fantasma', { onclick: function () { verEntrega(x.entregaLlegada); } }, 'Ver lo que entregó ' + x.esperaANombre)) : null));
      }
    });
    if (pendientes.length) filas.unshift(App.seccion('En espera', pendientes));
    App.add(caja, filas);
    /* mientras la espera siga abierta, se vuelve a mirar cada 4 s: cuando llega lo que faltaba, el bloque se actualiza solo */
    var abiertas = (esperas || []).some(function (x) { return x.entregaParcial === e.id && (x.estado === 'esperando' || x.estado === 'lista' || x.estado === 'relanzada'); });
    var firma = function (l) { return JSON.stringify((l || []).map(function (x) { return [x.id, x.estado, x.pedido && x.pedido.estado, x.entregaNueva, x.vencida]; })); };
    var vigilar = function () {
      setTimeout(function () {
        if (!abiertoPanel() || abierta !== e.id || !caja.isConnected) return;
        api().get('/api/esperas', { entrega: e.id, estado: 'todas' }).then(function (r) {
          if (!abiertoPanel() || abierta !== e.id || !caja.isConnected) return;
          /* solo se repinta si algo cambió (repintar igual cortaría un clic a mitad de camino) */
          if (firma(r.esperas) !== firma(esperas)) pintarEspera(e, r.esperas || [], caja); else vigilar();
        }).catch(function () {});
      }, 4000);
    };
    if (abiertas) vigilar();
  }

  /* ---------------- acción hacia afuera (plan §8) ---------------- */
  var TEXTO_ACCION = { send_message: 'Mandar el mail', create_event: 'Crear el evento' };
  function cortoHerramienta(h2) { return String(h2 || '').replace(/^mcp__.*__/, ''); }

  /* los argumentos de la acción como filas «Para: …», «Asunto: …» en vez de JSON; lo que no se conoce se muestra con su clave en palabras */
  var CLAVES = { to: 'Para', cc: 'Con copia', bcc: 'Con copia oculta', subject: 'Asunto', body: 'Mensaje', message: 'Mensaje', text: 'Mensaje',
    summary: 'Título', title: 'Título', start: 'Empieza', end: 'Termina', startTime: 'Empieza', endTime: 'Termina', when: 'Cuándo', date: 'Cuándo',
    attendees: 'Invitados', location: 'Dónde', description: 'Detalle', calendarId: 'Calendario', threadId: 'Conversación', replyTo: 'Responder a',
    name: 'Nombre', channel: 'Canal', url: 'Enlace' };
  var ORDEN = ['to', 'cc', 'bcc', 'subject', 'summary', 'title', 'start', 'startTime', 'when', 'date', 'end', 'endTime', 'location', 'attendees', 'body', 'message', 'text', 'description'];
  function claveHumana(k) {
    if (CLAVES[k]) return CLAVES[k];
    var t = String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function valorHumano(v) {
    if (v === null || v === undefined || v === '') return '';
    if (Array.isArray(v)) return v.map(valorHumano).filter(Boolean).join(', ');
    if (typeof v === 'object') { var f = v.dateTime || v.date || v.email || v.nombre || v.name; return f ? valorHumano(f) : JSON.stringify(v); }
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\d(T|$)/.test(v) && !isNaN(Date.parse(v))) return App.fecha ? App.fecha(v) : v;
    return String(v);
  }
  function tablaDetalle(d) {
    var ks = Object.keys(d).sort(function (a, b) {
      var i = ORDEN.indexOf(a), j = ORDEN.indexOf(b);
      return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);
    });
    var filas = ks.map(function (k) {
      var v = valorHumano(d[k]); if (!v) return null;
      return h('div.acc-dato', h('div.acc-clave', claveHumana(k)), h('div.acc-valor', v));
    }).filter(Boolean);
    return filas.length ? h('div.acc-datos', filas) : null;
  }
  function textoAprobar(ac) { return TEXTO_ACCION[cortoHerramienta(ac.herramienta)] || 'Aprobar y ejecutar'; }

  function pintarAccion(e, ac, caja) {
    App.vaciar(caja);
    if (!ac) return;
    var estado = {
      pendiente: h('span.insignia.aviso', 'Esperando tu aprobación'),
      ejecutando: h('span.insignia.aviso', h('span.giro'), ' Ejecutando…'),
      hecha: h('span.insignia.ok', 'Hecha'),
      error: h('span.insignia.error', 'Con error'),
      descartada: h('span.insignia', 'Descartada')
    }[ac.estado] || h('span.insignia', ac.estado);
    var tiene = ac.detalle && Object.keys(ac.detalle).length;
    var tabla = tiene ? tablaDetalle(ac.detalle) : null;
    App.add(caja, h('div.entrega-accion',
      h('h4', 'Acción propuesta'),
      h('div.acc-res', ac.resumen),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        h('span.insignia', { title: ac.herramienta }, App.humano.herramienta(ac.herramienta)), estado),
      tabla,
      tiene ? h('details.acc-tecnico', h('summary', 'Detalle técnico'), h('pre', JSON.stringify(ac.detalle, null, 2))) : null,
      ac.resultado && ac.estado !== 'pendiente' ? App.htmlSeguro(h('div.md-doc.doc-panel'), App.markdown(ac.resultado)) : null));
  }

  function vigilarAccion(id) {
    clearTimeout(relojAccion);
    relojAccion = setTimeout(function () {
      if (abierta !== id || !abiertoPanel()) return;
      api().get('/api/acciones', { entrega: id }).then(function (r) {
        if (r.accion && r.accion.estado === 'ejecutando') vigilarAccion(id);
        else { refrescarUltimas(); verEntrega(id); }
      }).catch(function () { vigilarAccion(id); });
    }, 3000);
  }
  var relojAccion = null;

  /* «Listo» tal como lo ofrece el pie ahora (con su paso de flujo), para que la hoja de revisar lo pueda usar */
  var listoActual = null;
  function revisar(e, rel) {
    App.Revisar.abrir(e, {
      archivo: rel, nombreAgente: nombre(e.agente),
      puedeCambiar: e.estado !== 'cambios' && !!e.sid && !!e.agente && !e.enCambios,
      puedeRetocar: e.estado !== 'cambios' && !e.enCambios,
      listo: function () { return abierta === e.id ? listoActual : null; },
      alCambios: function () {
        App.aviso(nombre(e.agente) + ' se puso a hacer los cambios.');
        if (App.Actividad) App.Actividad.ya();
        vigilarCambios(e.id);   // cuando llegue la versión nueva, se muestra sola (aunque el agente termine enseguida)
      },
      alCerrar: function () { if (abierta === e.id && abiertoPanel()) verEntrega(e.id); }
    });
  }

  function pintarPie(e, extra, pie) {
    listoActual = null;
    var ac = extra.accion, pendiente = !!(ac && ac.estado === 'pendiente');
    var pasoAprobacion = !!(extra.corrida && extra.corrida.pasoEstado === 'esperando_aprobacion' && extra.corrida.entrega === e.id);
    var botones = [];
    if (e.sid && e.agente && App.Agente.abrirSesion) botones.push(h('button.btn', { onclick: function () { App.Agente.abrirSesion(e.agente, e.sid); } }, 'Abrir en el chat'));
    if (e.estado !== 'cambios' && e.sid && e.agente && !e.enCambios && !pendiente) botones.push(h('button.btn', { onclick: function () { pedirCambios(e); } }, 'Pedir cambios'));
    var izq = botones; botones = [];
    if (e.enCambios) {
      // mientras trabaja no se marca: la versión nueva llega como otra entrega
    } else if (pendiente) {
      var ok = h('button.btn.primario', { onclick: function () {
        ok.disabled = true;
        api().post('/api/entregas/' + e.id + '/ejecutar').then(function () {
          App.aviso('Aprobado: ya se está ejecutando.');
          refrescarUltimas(); if (App.Actividad) App.Actividad.ya();
          verEntrega(e.id);
        }).catch(function (x) { App.fallo(x); ok.disabled = false; });
      } }, textoAprobar(ac));
      botones.push(h('button.btn', { onclick: function () {
        api().post('/api/entregas/' + e.id + '/descartar-accion').then(function () {
          App.aviso('Acción descartada.');
          refrescarUltimas(); verEntrega(e.id);
        }).catch(App.fallo);
      } }, 'Descartar'), ok);
    } else if (e.estado === 'sin_revisar' && !(ac && ac.estado === 'ejecutando')) {
      if (guardables(e).length) botones.push(h('button.btn', { onclick: function () { hojaBiblioteca(e, true, pasoAprobacion); } }, App.icono('libro'), 'Listo y a la biblioteca'));
      listoActual = function () { marcar(e, 'revisada', pasoAprobacion); };
      botones.push(h('button.btn.primario', { onclick: listoActual }, pasoAprobacion ? 'Listo, seguí' : 'Listo'));
    } else if (e.estado === 'revisada') {
      if (guardables(e).some(function (rel) { return !enBiblioteca(e, rel); })) botones.push(h('button.btn', { onclick: function () { hojaBiblioteca(e, false); } }, App.icono('libro'), 'Guardar en la biblioteca'));
      botones.push(h('button.btn.fantasma', { onclick: function () { marcar(e, 'sin-revisar'); } }, 'Marcar sin revisar'));
    }
    App.add(App.vaciar(pie), App.acciones(izq, botones));
  }

  /* ---------------- guardar en la biblioteca ---------------- */
  /* la copia de la biblioteca que salió de ese archivo de la entrega (si ya se guardó) */
  function enBiblioteca(e, rel) {
    return (e.enBiblioteca || []).filter(function (f) { return f.entrega && f.entrega.ruta === rel; })[0] || null;
  }
  function guardables(e) { return e.guardables || []; }

  /* elige qué archivos, para quién y si lo leen; guarda una copia y, si viene de «Listo y a la biblioteca», la marca revisada */
  function hojaBiblioteca(e, yListo, sigueFlujo) {
    var rels = guardables(e);
    var hj = App.hoja({ titulo: yListo ? 'Listo y a la biblioteca' : 'Guardar en la biblioteca', ancho: 520 });
    var checks = rels.map(function (rel) {
      var ck = h('input', { type: 'checkbox', checked: !enBiblioteca(e, rel) || rels.length === 1 });
      return { rel: rel, ck: ck, fila: h('label.biblio-elegir', ck, h('span', { title: rel }, rel.split('/').pop()),
        enBiblioteca(e, rel) ? h('span.insignia', 'ya está') : null) };
    });
    var ag = e.agente && App.agente(e.agente), deps = (App.E.oficina && App.E.oficina.departamentos) || [];
    var porDefecto = ag && ag.departamento && deps.some(function (d) { return d.id === ag.departamento; }) ? ag.departamento : 'compartido';
    var sel = App.elegir({ forma: 'chips', etiqueta: 'Para quién', valor: porDefecto,
      opciones: [{ valor: 'compartido', titulo: 'Toda la oficina', icono: 'personas' }].concat(deps.map(function (d) { return { valor: d.id, titulo: d.nombre, color: d.color }; })) });
    var leer = h('input', { type: 'checkbox' });
    var err = h('div.error-txt');
    App.add(hj.cuerpo,
      h('div.fila-campo', h('label.etiqueta-campo', rels.length > 1 ? 'Qué archivos' : 'Archivo'),
        rels.length > 1 ? h('div', checks.map(function (c) { return c.fila; })) : h('div', rels[0].split('/').pop())),
      h('div.fila-campo', h('label.etiqueta-campo', 'Para quién'),
        h('div.ayuda', 'Lo puede consultar quien elijas. Después lo podés cambiar desde la biblioteca.'), sel),
      h('label.biblio-elegir', leer, h('span', 'Que lo lean ahora y tomen notas desde su rol')),
      h('div.ayuda', { style: { marginTop: '10px' } }, 'Se guarda una copia: si después pedís cambios, la de la biblioteca queda como está. El bibliotecario le arma una ficha y la suma al catálogo.'),
      err);
    var ok = h('button.btn.primario', { onclick: function () {
      var elegidos = rels.length > 1 ? checks.filter(function (c) { return c.ck.checked; }).map(function (c) { return c.rel; }) : rels;
      if (!elegidos.length) { err.textContent = 'Elegí al menos un archivo.'; return; }
      ok.disabled = true; err.textContent = '';
      api().post('/api/entregas/' + e.id + '/biblioteca', { archivos: elegidos, departamento: sel.valor(), leer: leer.checked }).then(function (r) {
        hj.cerrar();
        if (App.Biblioteca && App.Biblioteca.vigilarEstado) App.Biblioteca.vigilarEstado();
        var n = (r.archivos || []).length, msg = n === 1 ? 'Guardado en la biblioteca.' : 'Guardados ' + n + ' archivos en la biblioteca.';
        if (yListo) marcar(e, 'revisada', sigueFlujo, msg + (sigueFlujo ? ' El flujo sigue.' : ''));
        else { App.aviso(msg); verEntrega(e.id); }
      }).catch(function (x) { err.textContent = x.message; ok.disabled = false; });
    } }, yListo ? 'Guardar y marcar listo' : 'Guardar');
    App.add(hj.pie, h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), ok);
  }

  /* ---------------- pedir cambios (E4) ---------------- */
  function pedirCambios(e) {
    var hj = App.hoja({ titulo: 'Pedir cambios a ' + nombre(e.agente), ancho: 520 });
    var txt = h('textarea.campo', { rows: 6, maxlength: 4000, autofocus: true, placeholder: 'Qué querés que cambie. Por ejemplo: más corto, con una tabla al final, sin el punto 3.' });
    var err = h('div.error-txt');
    App.add(hj.cuerpo, h('div.fila-campo', h('label.etiqueta-campo', '«' + e.titulo + '»'), txt,
      h('div.ayuda', 'Se lo pide en la misma conversación. La versión nueva aparece como otra entrega sin revisar y esta queda reemplazada.')), err);
    var ok = h('button.btn.primario', { onclick: function () {
      var v = txt.value.trim(); if (!v) { err.textContent = 'Escribí qué querés que cambie.'; txt.focus(); return; }
      ok.disabled = true; err.textContent = '';
      api().post('/api/entregas/' + e.id + '/cambios', { texto: v }).then(function () {
        hj.cerrar();
        App.aviso(nombre(e.agente) + ' se puso a hacer los cambios.');
        if (App.Actividad) App.Actividad.ya();
        verEntrega(e.id);
      }).catch(function (x) { err.textContent = x.message; ok.disabled = false; });
    } }, 'Pedir cambios');
    App.add(hj.pie, h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), ok);
  }

  /* mientras el agente hace los cambios, se vuelve a leer la entrega cada 3 s; al terminar se muestra la versión nueva */
  var relojCambios = null;
  function vigilarCambios(id) {
    clearTimeout(relojCambios);
    relojCambios = setTimeout(function () {
      if (abierta !== id || !abiertoPanel()) return;
      api().get('/api/entregas/' + id).then(function (r) {
        var e = r.entrega;
        if (e.enCambios) { vigilarCambios(id); return; }
        if (e.estado === 'cambios') {
          return api().get('/api/entregas', { limite: 20 }).then(function (l) {
            var hija = (l.entregas || []).filter(function (x) { return x.padre === id; })[0];
            refrescarUltimas();
            if (hija) verEntrega(hija.id); else pintarDetalle(e);
          });
        }
        pintarDetalle(e);   // falló: queda como estaba (el error llega como aviso)
      }).catch(function () { vigilarCambios(id); });
    }, 3000);
  }

  function marcar(e, como, sigueFlujo, msg) {
    api().post('/api/entregas/' + e.id + '/' + como).then(function (r) {
      sinRevisar = r.sinRevisar | 0;
      refrescarUltimas();
      if (como === 'revisada') {
        App.aviso(msg || (sigueFlujo ? 'Listo: el flujo sigue.' : 'Marcada como revisada.'));
        siguienteOLista(e.id);
      } else verEntrega(e.id);
    }).catch(App.fallo);
  }

  /* después de «Listo»: la próxima sin revisar, o la lista si no queda ninguna */
  function siguienteOLista(actual) {
    api().get('/api/entregas', { estado: 'sin_revisar', limite: 1 }).then(function (r) {
      var sig = (r.entregas || [])[0];
      if (sig && sig.id !== actual) verEntrega(sig.id); else pintarLista();
    }).catch(function () { pintarLista(); });
  }

  /* tecla N sin avisos: la próxima entrega sin revisar */
  function siguiente() {
    if (!sinRevisar) return false;
    api().get('/api/entregas', { estado: 'sin_revisar', limite: 1 }).then(function (r) {
      var e = (r.entregas || [])[0]; if (e) abrir(e.id);
    }).catch(App.fallo);
    if (App.Oficina && App.Oficina.enfocarLugar) App.Oficina.enfocarLugar('entregables');
    return true;
  }

  if (App.on) App.on('actividad', alActividad);

  return {
    abrir: abrir, siguiente: siguiente,
    abierta: function () { return abierta; },
    sinRevisar: function () { return sinRevisar; },
    refrescar: refrescarUltimas,
    alCerrarPanel: function () { abierta = null; clearTimeout(relojAccion); },
    _verEntrega: verEntrega
  };
})();
