/* Tarjetas de lo que hizo un agente en una charla (docs/plan-recados.md, U2 y U3): pasarle trabajo a un colega (con unos
   segundos para deshacer, o como propuesta), preguntarle algo a la persona con opciones, o proponer una acción (evento,
   mail). Se ven debajo de la respuesta en la charla y, lo que espera a la persona, en Bandeja › Hoy («Te esperan»).
   También arrancar un flujo (arrancar_flujo) y los cambios en la oficina que propone un agente (proponer_tarea, y la
   secretaría todo lo del Creador; docs/plan-secretaria-creadora.md).
   Usa POST /api/charlas/tarjetas/<id>; elegir una opción manda «Elijo: …» en esa charla (App.Agente.enviarEn). */
window.App = window.App || {};
App.Tarjetas = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var reloj = null;

  function nombre(id) { var a = App.agente && App.agente(id); return a ? a.nombre : id; }

  /* la cuenta regresiva de las delegaciones que esperan (una sola para toda la pantalla) */
  function tictac() {
    var hay = false;
    [].forEach.call(document.querySelectorAll('[data-empieza]'), function (el) {
      var s = Math.max(0, Math.round(+el.getAttribute('data-empieza') - Date.now() / 1000));
      el.textContent = s > 0 ? 'Empieza en ' + s + ' s' : 'Empezando…';
      hay = true;
    });
    if (!hay) { clearInterval(reloj); reloj = null; }
  }
  function vigilarReloj() { if (!reloj) reloj = setInterval(tictac, 1000); setTimeout(tictac, 0); }

  function caja(clase, icono, cab, estado, cuerpo, botones) {
    return h('div.tj.' + clase,
      h('div.tj-cab', App.icono(icono), h('span', cab), estado ? h('span.tj-est', estado) : null),
      h('div.tj-cuerpo', cuerpo),
      botones && botones.length ? h('div.tj-pie', botones) : null);
  }
  function boton(texto, clase, accion) {
    return h('button.btn.chico' + (clase ? '.' + clase : ''), { onclick: function (ev) {
      var b = ev.currentTarget; b.disabled = true;
      Promise.resolve(accion()).catch(function () {}).then(function () { b.disabled = false; });
    } }, texto);
  }
  function enlaceCharla(t) {
    return h('button.tj-ver', { onclick: function () { App.Agente.abrirSesion(t.agente, t.session); } }, 'Ver la charla con ' + nombre(t.agente));
  }
  function decidir(t, accion, opcion, alCambiar) {
    var cuerpo = { accion: accion };
    if (opcion !== undefined) cuerpo.opcion = opcion;
    return App.api.post('/api/charlas/tarjetas/' + t.id, cuerpo).then(function (r) {
      if (r.mensaje && App.Agente && App.Agente.enviarEn) App.Agente.enviarEn(r.mensaje.agente, r.mensaje.session, r.mensaje.texto);
      if (alCambiar) alCambiar(r.tarjeta);
      if (App.Actividad) setTimeout(App.Actividad.ya, 200);
    }).catch(function (e) { App.aviso(e.message, true); });
  }

  var EST_DELEG = { propuesta: 'Te espera', esperando: '', corriendo: 'Trabajando', programada: 'Programado', hecha: 'Hecho', fallida: 'Falló', cancelada: 'Cancelado' };
  /* `op`: {enBandeja, alCambiar} */
  function delegacion(t, op) {
    op = op || {};
    var para = nombre(t.para), de = nombre(t.agente);
    var cab = op.enBandeja ? de + ' te propone pasárselo a ' + para
      : t.estado === 'propuesta' ? '¿Se lo paso a ' + para + '?' : t.estado === 'cancelada' ? 'No se lo pasó a ' + para : 'Le pasó a ' + para;
    var estado = t.estado === 'esperando' ? h('span', { 'data-empieza': t.empieza || 0 }, 'Empieza en…') : EST_DELEG[t.estado] || t.estado;
    var cuerpo = [h('div.tj-tit', t.nombre), h('details.tj-consigna', h('summary', 'Consigna'), h('div', t.consigna))];
    if (t.estado === 'programada' && t.cuando) cuerpo.push(h('div.tj-nota', 'Para el ' + t.cuando.fecha.split('-').reverse().join('/') + ' a las ' + t.cuando.hora + '.'));
    if (t.estado === 'fallida' && t.error) cuerpo.push(h('div.tj-nota.error', t.error));
    var bs = [];
    if (op.enBandeja) bs.push(enlaceCharla(t));
    if (t.estado === 'propuesta') bs.push(boton('Descartar', 'fantasma', function () { return decidir(t, 'descartar', undefined, op.alCambiar); }), boton('Pasárselo', 'primario', function () { return decidir(t, 'confirmar', undefined, op.alCambiar); }));
    if (t.estado === 'esperando') bs.push(boton('Deshacer', '', function () { return decidir(t, 'cancelar', undefined, op.alCambiar); }), boton('Empezar ya', 'primario', function () { return decidir(t, 'ya', undefined, op.alCambiar); }));
    if (t.estado === 'programada') bs.push(boton('Cancelar', 'fantasma', function () { return decidir(t, 'cancelar', undefined, op.alCambiar); }));
    if (t.entrega) bs.push(boton('Ver lo que entregó', t.estado === 'hecha' ? 'primario' : '', function () { App.Entregables.abrir(t.entrega); }));
    if (t.estado === 'esperando') vigilarReloj();
    return caja('deleg' + (t.estado === 'cancelada' ? '.apagada' : ''), 'flecha', cab, estado, cuerpo, bs);
  }

  function pregunta(t, op) {
    op = op || {};
    var abierta = t.estado === 'abierta';
    var ops = (t.opciones || []).map(function (o, i) {
      return h('button.tj-opcion' + (t.elegida === i ? '.elegida' : ''), { disabled: !abierta, onclick: function (ev) { ev.currentTarget.disabled = true; decidir(t, 'responder', i, op.alCambiar); } },
        h('b', o.texto), o.detalle ? h('small', o.detalle) : null);
    });
    return caja('preg' + (abierta ? '' : '.apagada'), 'bombilla', op.enBandeja ? nombre(t.agente) + ' te pregunta' : 'Te pregunta', abierta ? 'Te espera' : 'Respondida',
      [h('div.tj-tit', t.texto), ops.length ? h('div.tj-opciones', ops) : null,
        abierta ? h('div.tj-nota', op.enBandeja ? 'Tocá una opción: se la contestás en su charla.' : 'Tocá una opción o contestale con tus palabras.') : null],
      op.enBandeja ? [enlaceCharla(t)] : null);
  }

  var EST_ACCION = { pendiente: 'Te espera', aprobada: 'Aprobada', ejecutando: 'Haciéndolo', hecha: 'Hecha', ejecutada: 'Hecha', descartada: 'Descartada', fallida: 'Falló', error: 'Falló' };
  function accion(ac, op) {
    op = op || {};
    var bs = [];
    if (op.enBandeja && ac.sid) bs.push(enlaceCharla({ agente: ac.agente, session: ac.sid }));
    if (ac.entrega) bs.push(boton(ac.estado === 'pendiente' ? 'Revisar y aprobar' : 'Ver', ac.estado === 'pendiente' ? 'primario' : '', function () { App.Entregables.abrir(ac.entrega); }));
    return caja('accion' + (ac.estado === 'descartada' ? '.apagada' : ''), 'calendario', op.enBandeja ? nombre(ac.agente) + ' propone' : 'Propuesta', EST_ACCION[ac.estado] || ac.estado,
      [h('div.tj-tit', ac.resumen), App.Propuestas ? App.Propuestas.tarjeta(ac) : null], bs);
  }

  /* arrancar un flujo de la oficina (arrancar_flujo): como una delegación, con ventana para deshacer o como propuesta */
  var EST_FLUJO = { propuesta: 'Te espera', esperando: '', arrancado: 'Arrancó', fallida: 'Falló', cancelada: 'Cancelado' };
  function flujo(t, op) {
    op = op || {};
    var fl = '«' + (t.flujoNombre || t.flujo) + '»';
    var cab = op.enBandeja ? nombre(t.agente) + ' te propone arrancar ' + fl
      : t.estado === 'propuesta' ? '¿Arranco ' + fl + '?' : t.estado === 'cancelada' ? 'No arrancó ' + fl : t.estado === 'fallida' ? 'No pudo arrancar ' + fl : 'Flujo ' + fl;
    var estado = t.estado === 'esperando' ? h('span', { 'data-empieza': t.empieza || 0 }, 'Empieza en…') : EST_FLUJO[t.estado] || t.estado;
    var cuerpo = [h('div.tj-tit', t.nombre)];
    if (t.contexto) cuerpo.push(h('details.tj-consigna', h('summary', 'Con qué arranca'), h('div', t.contexto)));
    if (t.estado === 'fallida' && t.error) cuerpo.push(h('div.tj-nota.error', t.error));
    var bs = [];
    if (op.enBandeja) bs.push(enlaceCharla(t));
    if (t.estado === 'propuesta') bs.push(boton('Descartar', 'fantasma', function () { return decidir(t, 'descartar', undefined, op.alCambiar); }), boton('Arrancarlo', 'primario', function () { return decidir(t, 'confirmar', undefined, op.alCambiar); }));
    if (t.estado === 'esperando') bs.push(boton('Deshacer', '', function () { return decidir(t, 'cancelar', undefined, op.alCambiar); }), boton('Arrancar ya', 'primario', function () { return decidir(t, 'ya', undefined, op.alCambiar); }));
    if (t.estado === 'arrancado' && t.corrida && App.Flujos && App.Flujos.verCorrida) bs.push(boton('Ver el flujo', '', function () { App.Flujos.verCorrida(t.corrida); }));
    if (t.estado === 'esperando') vigilarReloj();
    return caja('flujo' + (t.estado === 'cancelada' ? '.apagada' : ''), 'flujo', cab, estado, cuerpo, bs);
  }

  function de(t, op) { return t.tipo === 'pregunta' ? pregunta(t, op) : t.tipo === 'flujo' ? flujo(t, op) : delegacion(t, op); }

  /* ---- cambios en la oficina que propuso la secretaría (docs/plan-secretaria-creadora.md) ----
     Son tarjetas del Creador: hasta 3 y sin nada en borrador se ven enteras (datos clave y la cita); si son más o a alguna le
     falta algo, un resumen con «Abrir en el Creador». Se aprueban con POST /api/creador/aplicar y se descartan con DELETE
     /api/creador/tarjetas/<id>. `op`: {enBandeja, agente, session, alCambiar} */
  var PENDIENTE = { lista: true, borrador: true, error: true };
  var MAX_ENTERAS = 3;
  function resumenDe(t, todas) {
    if (App.Creador && App.Creador.resumenTarjeta) return App.Creador.resumenTarjeta(t, todas);
    var d = t.datos || {};
    return { titulo: d.nombre || d.texto || t.id, tipo: t.tipo, icono: 'chispa', accion: t.accion, estado: t.estado, campos: [] };
  }
  function abrirCreador() { App.Nav.ir('#/equipo/creador'); }
  function aplicar(ts, op) {
    var quitar = ts.filter(function (t) { return t.accion === 'quitar'; });
    var conf = quitar.length ? App.confirmar(quitar.length === 1 ? '¿Quitar algo de la oficina?' : '¿Quitar ' + quitar.length + ' cosas de la oficina?',
      'Se va a quitar: ' + quitar.map(function (t) { return resumenDe(t, ts).titulo; }).join(', ') + '.', 'Quitar y aprobar', true) : Promise.resolve(true);
    return conf.then(function (si) {
      if (!si) return;
      var cuerpo = { ids: ts.map(function (t) { return t.id; }) };
      if (quitar.length) cuerpo.confirmarQuitar = true;
      return App.api.post('/api/creador/aplicar', cuerpo).then(function (r) {
        var res = r.resultados || [], ok = res.filter(function (x) { return x.ok; }).length, mal = res.filter(function (x) { return !x.ok; });
        if (App.recargarOficina) App.recargarOficina().catch(function () {});
        if (ok) App.aviso(ok === 1 ? 'Listo: se creó 1 cosa.' : 'Listo: se crearon ' + ok + ' cosas.');
        if (mal.length) App.aviso(mal[0].error || 'No se pudo crear.', true);
      }).catch(function (e) { App.aviso(e.message, true); }).then(function () {
        if (op.alCambiar) op.alCambiar();
        if (App.Actividad) setTimeout(App.Actividad.ya, 200);
      });
    });
  }
  function descartarTodas(ts, op) {
    return Promise.all(ts.map(function (t) { return App.api.del('/api/creador/tarjetas/' + encodeURIComponent(t.id)); }))
      .catch(function (e) { App.aviso(e.message, true); })
      .then(function () { if (op.alCambiar) op.alCambiar(); if (App.Actividad) setTimeout(App.Actividad.ya, 200); });
  }
  function cambios(lista, op) {
    op = op || {};
    var vivas = (lista || []).filter(function (t) { return t.estado !== 'descartada'; });
    if (!vivas.length) return null;
    var pend = vivas.filter(function (t) { return PENDIENTE[t.estado]; });
    var listas = vivas.filter(function (t) { return t.estado === 'lista'; });
    var borr = vivas.filter(function (t) { return t.estado === 'borrador'; });
    var compacto = vivas.length > MAX_ENTERAS || borr.length > 0;
    /* los demás agentes solo proponen tareas programadas: la cabecera lo dice así */
    var soloTareas = vivas.every(function (t) { return t.tipo === 'tarea'; });
    var cab = soloTareas
      ? (op.enBandeja ? nombre(op.agente) + (vivas.length === 1 ? ' te propone una tarea programada' : ' te propone tareas programadas')
        : vivas.length === 1 ? 'Tarea programada' : 'Tareas programadas · ' + vivas.length)
      : op.enBandeja ? nombre(op.agente) + ' te propone cambios en la oficina'
      : vivas.length === 1 ? 'Propuesta para la oficina' : 'Propuestas para la oficina · ' + vivas.length;
    var estado = !pend.length ? (vivas.every(function (t) { return t.estado === 'creada'; }) ? 'Creado' : '')
      : borr.length ? (borr.length === 1 ? '1 con dudas' : borr.length + ' con dudas') : 'Te espera';
    var cuerpo = [];
    if (compacto) {
      cuerpo.push(h('ul.tj-cambios', vivas.map(function (t) {
        var r = resumenDe(t, vivas);
        return h('li', h('span.tj-cambio-tipo', r.tipo), h('span.tj-cambio-tit', r.titulo),
          h('span.tj-cambio-est.' + t.estado, t.estado === 'lista' ? r.accion : r.estado));
      })));
      borr.forEach(function (t) {
        (t.faltantes || []).slice(0, 2).forEach(function (f) { cuerpo.push(h('div.tj-nota', 'Falta: ' + (f.pregunta || f.campo || String(f)))); });
      });
    } else {
      vivas.forEach(function (t) {
        var r = resumenDe(t, vivas);
        cuerpo.push(h('div.tj-cambio',
          h('div.tj-cambio-cab', App.icono(r.icono), h('span', r.accion + ' · ' + r.tipo), h('span.tj-cambio-est.' + t.estado, t.estado === 'lista' ? '' : r.estado)),
          h('div.tj-tit', r.titulo),
          r.campos.length ? h('div.tj-cambio-campos', r.campos) : null,
          t.estado === 'error' && t.error ? h('div.tj-nota.error', t.error) : null,
          t.origen ? h('blockquote.tb-origen', t.origen) : null));
      });
    }
    var bs = [];
    if (op.enBandeja && op.session) bs.push(enlaceCharla({ agente: op.agente, session: op.session }));
    if (pend.length) bs.push(boton('Abrir en el Creador', compacto ? 'primario' : 'fantasma', abrirCreador));
    else bs.push(boton('Ver en el Creador', 'fantasma', abrirCreador));
    if (pend.length && !compacto) bs.push(boton('Descartar', 'fantasma', function () { return descartarTodas(pend, op); }));
    if (listas.length) {
      var txt = !compacto ? (listas.length === 1 ? 'Aprobar' : 'Aprobar las ' + listas.length) : listas.length === 1 ? 'Aprobar la lista' : 'Aprobar las ' + listas.length + ' listas';
      bs.push(boton(txt, compacto ? '' : 'primario', function () { return aplicar(listas, op); }));
    }
    return caja('cambio' + (pend.length ? '' : '.apagada'), 'chispa', cab, estado, cuerpo, bs);
  }

  return { delegacion: delegacion, pregunta: pregunta, accion: accion, flujo: flujo, de: de, cambios: cambios };
})();
