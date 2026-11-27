/* Tarjetas de lo que hizo un agente en una charla (docs/plan-recados.md, U2 y U3): pasarle trabajo a un colega (con unos
   segundos para deshacer, o como propuesta), preguntarle algo a la persona con opciones, o proponer una acción (evento,
   mail). Se ven debajo de la respuesta en la charla y, lo que espera a la persona, en Bandeja › Hoy («Te esperan»).
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
  function decidir(t, accion, opcion, alCambiar, extra) {
    var cuerpo = { accion: accion };
    if (opcion !== undefined) cuerpo.opcion = opcion;
    if (extra) Object.keys(extra).forEach(function (k) { cuerpo[k] = extra[k]; });
    return App.api.post('/api/charlas/tarjetas/' + t.id, cuerpo).then(function (r) {
      if (r.mensaje && App.Agente && App.Agente.enviarEn) App.Agente.enviarEn(r.mensaje.agente, r.mensaje.session, r.mensaje.texto);
      if (alCambiar) alCambiar(r.tarjeta);
      if (App.Actividad) setTimeout(App.Actividad.ya, 200);
    }).catch(function (e) { App.aviso(e.message, true); });
  }

  /* lo que el agente le compartió al colega o al flujo de WhatsApp: exactamente esos mensajes, con un candado */
  function compartido(t) {
    if (!t.compartido || !t.compartido.length) return null;
    var n = t.compartido.length;
    return h('details.tj-compartido', h('summary', App.icono('candado'), 'Compartió ' + (n === 1 ? '1 mensaje' : n + ' mensajes') + ' de WhatsApp'),
      t.compartido.map(function (c) {
        var f = new Date(c.ts * 1000);
        var cuando = String(f.getDate()).padStart(2, '0') + '/' + String(f.getMonth() + 1).padStart(2, '0') + ' ' + String(f.getHours()).padStart(2, '0') + ':' + String(f.getMinutes()).padStart(2, '0');
        return h('div.tj-cita', h('small', c.de + (c.chat && c.chat !== c.de ? ' en «' + c.chat + '»' : '') + ' · ' + cuando), h('div', c.texto));
      }),
      h('div.tj-nota', 'Le llegó solo esto, no el chat.'));
  }
  function fecha(cuando) { return cuando.fecha.split('-').reverse().join('/') + ' a las ' + cuando.hora; }

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
    var cmp = compartido(t); if (cmp) cuerpo.push(cmp);
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

  /* un flujo que arrancó el agente: propuesta, ventana para deshacer o programado, después sigue la corrida (en qué paso
     va) y, cuando te espera, se aprueba, se piden cambios o se da por hecho el paso tuyo ahí mismo */
  var EST_FLUJO = { propuesta: 'Te espera', esperando: '', programada: 'Programado', en_curso: 'En curso', te_espera: 'Te espera', hecha: 'Terminado', trabada: 'Trabado', cancelada: 'Cancelado', fallida: 'No arrancó' };
  function flujo(t, op) {
    op = op || {};
    var de = nombre(t.agente), fl = t.flujoNombre || t.flujo;
    var cab = op.enBandeja ? (t.estado === 'propuesta' ? de + ' te propone arrancar ' + fl : 'Flujo ' + fl + ' · lo arrancó ' + de)
      : t.estado === 'propuesta' ? '¿Arranco ' + fl + '?' : t.estado === 'cancelada' && !t.corrida ? 'No arrancó ' + fl : 'Flujo ' + fl;
    var estado = t.estado === 'esperando' ? h('span', { 'data-empieza': t.empieza || 0 }, 'Empieza en…') : EST_FLUJO[t.estado] || t.estado;
    var cuerpo = [h('div.tj-tit', t.nombre)];
    if (t.por_que && (t.estado === 'propuesta' || t.estado === 'esperando')) cuerpo.push(h('div.tj-nota', t.por_que));
    /* los pasos, con el actual marcado */
    if (t.pasos && t.pasos.length) {
      cuerpo.push(h('div.tj-pasos', t.pasos.map(function (p, i) {
        var cls = typeof t.paso !== 'number' ? '' : i < t.paso || t.estado === 'hecha' ? '.hecho' : i === t.paso ? '.actual' : '';
        return h('span.tj-paso' + cls, p);
      })));
    }
    if (t.estado === 'te_espera') cuerpo.push(h('div.tj-nota', t.espera === 'aprobacion' ? (nombre(t.quien) + ' terminó «' + t.pasoNombre + '»: falta tu aprobación.') : 'Te toca: ' + t.pasoNombre + '.'));
    else if (t.estado === 'en_curso' && t.pasoNombre) cuerpo.push(h('div.tj-nota', 'Ahora: ' + t.pasoNombre + (t.quien ? ' (' + nombre(t.quien) + ')' : '') + '.'));
    if (t.estado === 'programada' && t.cuando) cuerpo.push(h('div.tj-nota', 'Para el ' + fecha(t.cuando) + '.'));
    if ((t.estado === 'trabada' || t.estado === 'fallida') && t.error) cuerpo.push(h('div.tj-nota.error', t.error));
    var datos = t.datos && typeof t.datos === 'object' ? Object.keys(t.datos) : [];
    cuerpo.push(h('details.tj-consigna', h('summary', 'Con qué arranca'), h('div', (t.contexto || '') + (datos.length ? '\n\n' + datos.map(function (k) { return k + ': ' + t.datos[k]; }).join('\n') : ''))));
    var cmp = compartido(t); if (cmp) cuerpo.push(cmp);
    /* pedir cambios o contar cómo te fue: una nota que se abre ahí mismo */
    var nota = null;
    var conNota = function (accion, etiqueta, ph, obligatoria) {
      return boton(etiqueta, '', function () {
        if (!nota) {
          nota = h('textarea.campo', { rows: 2, placeholder: ph });
          cuerpoEl.appendChild(nota); nota.focus(); return;
        }
        if (obligatoria && !nota.value.trim()) { nota.focus(); return; }
        return decidir(t, accion, undefined, op.alCambiar, { nota: nota.value });
      });
    };
    var bs = [];
    if (op.enBandeja) bs.push(enlaceCharla(t));
    else if (t.corrida && App.Flujos && App.Flujos.verCorrida) bs.push(h('button.tj-ver', { onclick: function () { App.Flujos.verCorrida(t.corrida); } }, 'Ver la corrida'));
    if (t.estado === 'propuesta') bs.push(boton('Descartar', 'fantasma', function () { return decidir(t, 'descartar', undefined, op.alCambiar); }), boton('Arrancarlo', 'primario', function () { return decidir(t, 'confirmar', undefined, op.alCambiar); }));
    if (t.estado === 'esperando') bs.push(boton('Deshacer', '', function () { return decidir(t, 'cancelar', undefined, op.alCambiar); }), boton('Empezar ya', 'primario', function () { return decidir(t, 'ya', undefined, op.alCambiar); }));
    if (t.estado === 'programada') bs.push(boton('Cancelar', 'fantasma', function () { return decidir(t, 'cancelar', undefined, op.alCambiar); }), boton('Arrancar ya', '', function () { return decidir(t, 'ya', undefined, op.alCambiar); }));
    if (t.estado === 'te_espera' && t.espera === 'aprobacion') {
      if (t.entrega) bs.push(boton('Ver lo que entregó', '', function () { App.Entregables.abrir(t.entrega); }));
      bs.push(conNota('cambios', 'Pedir cambios', 'Qué querés que cambie', true), boton('Aprobar', 'primario', function () { return decidir(t, 'aprobar', undefined, op.alCambiar); }));
    }
    if (t.estado === 'te_espera' && t.espera === 'persona') bs.push(conNota('hecho', 'Hecho, con una nota', 'Lo que quieras contar (opcional)', false), boton('Hecho', 'primario', function () { return decidir(t, 'hecho', undefined, op.alCambiar); }));
    if (t.estado === 'esperando') vigilarReloj();
    var el = caja('flujo' + (t.estado === 'cancelada' || t.estado === 'fallida' ? '.apagada' : ''), 'flujo', cab, estado, cuerpo, bs);
    var cuerpoEl = el.querySelector('.tj-cuerpo');
    return el;
  }

  function de(t, op) { return t.tipo === 'pregunta' ? pregunta(t, op) : t.tipo === 'flujo' ? flujo(t, op) : delegacion(t, op); }

  return { delegacion: delegacion, pregunta: pregunta, accion: accion, flujo: flujo, de: de };
})();
