/* Parte del día (docs/plan-creador-flujos.md §10 y §12): panel derecho en modo «parte».
   Secciones: te necesita, para revisar, flujos en curso, qué pasó, bloqueos y próximas tareas. Arriba, el parte narrado por el
   coordinador si existe; si no, un botón para pedírselo. El pie «Listo, ya lo vi» marca el parte como visto. */
window.App = window.App || {};
App.Parte = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var api = function () { return App.api; };
  var pedido = 0;          // para descartar respuestas viejas
  var reloj = null;        // sondeo mientras el coordinador redacta
  var redactando = false;
  var intentos = 0;

  function abiertoPanel() { return App.modoDerecho && App.modoDerecho() === 'parte'; }
  function coordinador() {
    var o = App.E.oficina || { agentes: [] };
    return o.agentes.filter(function (a) { return (a.permisos || []).indexOf('coordinador') >= 0; })[0] || null;
  }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function diasTxt(d) {
    if (d < 1) return Math.max(1, Math.round(d * 24)) + ' h';
    var n = Math.round(d * 10) / 10;
    return (n % 1 ? n.toFixed(1).replace('.', ',') : String(n)) + (n === 1 ? ' día' : ' días');
  }

  function abrir() {
    if (App.Agente && App.Agente.alCerrar) App.Agente.alCerrar();
    App.abrirDerecho('parte');
    cargar(true);
  }

  function cerrarPanel() { clearTimeout(reloj); reloj = null; redactando = false; intentos = 0; pedido++; }

  function cabecera(sub) {
    return App.cabPanel({ icono: 'parte', titulo: 'Hoy', sub: sub });
  }

  function cargar(conGiro) {
    if (!abiertoPanel()) return;
    var n = ++pedido, der = App.dom.derecho;
    if (conGiro) App.add(App.vaciar(der), cabecera(''), h('div.der-cuerpo', App.cargando('Trayendo lo que te espera…')));
    var pend = api().get('/api/charlas/pendientes').catch(function () { return { tarjetas: [], acciones: [] }; });
    Promise.all([api().get('/api/parte'), pend]).then(function (r) {
      if (n === pedido && abiertoPanel()) pintar(r[0], r[1]);
    }).catch(function (e) {
      if (n !== pedido || !abiertoPanel()) return;
      App.add(App.vaciar(der), cabecera(''), h('div.der-cuerpo', h('div.vacio', e.message)));
    });
  }

  /* ---------------- piezas ---------------- */
  function seccion(titulo, hijos) {
    return h('div.det-sec.parte-sec', h('h4', titulo), hijos);
  }

  function quienMarca(id) {
    var a = id && id !== 'persona' && App.agente(id);
    return a || App.Yo.retrato('retrato', 64);
  }
  function quienNombre(id) { return App.humano.quien(id || 'persona'); }

  /* todas las filas del parte son la misma pieza: marca · qué · bajada · estado · UN botón principal; tocarla hace lo mismo */
  function fila(marca, titulo, sub, estado, texto, accion) {
    return App.filaDecision({ marca: marca, titulo: titulo, sub: sub, estado: estado, alTocar: accion || null,
      principal: accion && texto ? h('button.btn.chico', { onclick: accion }, texto) : null });
  }

  function filaAviso(a) {
    var ag = a.agente && App.agente(a.agente);
    return fila(ag || (a.tipo === 'flujo' ? 'flujo' : 'parte'), a.texto, a.creado ? App.hace(a.creado) : null, null, 'Ver', function () { abrirAviso(a); });
  }
  function abrirAviso(a) {
    /* App.Avisos.abrir ya manda los de flujo a App.Flujos.verCorrida y los marca vistos sin desincronizar el banner */
    if (App.Avisos) App.Avisos.abrir(a.id);
    else if (a.tipo === 'flujo' && App.Flujos && App.Flujos.verCorrida) App.Flujos.verCorrida(a.ref);
  }

  function filaEntrega(e) {
    var ag = e.agente && App.agente(e.agente);
    return fila(ag || 'libro', e.titulo, (ag ? ag.nombre + ' · ' : '') + App.hace(e.creada), null, 'Revisar', function () { App.Entregables.abrir(e.id); });
  }

  /* lo que falta revisar, como tarjetas (las mismas de Bandeja › Para revisar) */
  function tarjetasHoy(entregas) {
    var cont = h('div.entregas');
    App.Entregables.pintarTarjetas(cont, entregas, function () { cargar(false); });
    return cont;
  }

  function filaFlujo(f) {
    var trabado = f.dias > 1;
    return fila(quienMarca(f.quien), f.nombre || f.flujoNombre,
      (f.flujoNombre ? f.flujoNombre + ' · ' : '') + 'paso ' + (f.paso + 1) + (f.pasoNombre ? ': ' + f.pasoNombre : '') + ' · ' + quienNombre(f.quien),
      trabado ? h('span.insignia.aviso', 'trabado hace ' + diasTxt(f.dias)) : null,
      'Ver', function () { if (App.Flujos && App.Flujos.verCorrida) App.Flujos.verCorrida(f.corrida); });
  }

  /* una cadena que se repite (A espera seguido a B): se ofrece pasarla a flujo; el borrador se abre en el editor y se guarda ahí */
  function pintarPatrones(cuerpo) {
    var caja = h('div');
    cuerpo.appendChild(caja);
    api().get('/api/esperas/patrones').then(function (r) {
      if (!abiertoPanel() || !caja.parentNode) return;
      var ps = r.patrones || [];
      if (!ps.length) return;
      caja.appendChild(seccion('Se repite' + (ps.length > 1 ? ' (' + ps.length + ')' : ''), h('div.parte-filas', ps.map(function (x) {
        var btn = h('button.btn.chico', { onclick: function () {
          btn.disabled = true;
          api().post('/api/esperas/flujo', { agente: x.agente, esperaA: x.esperaA }).then(function (d) {
            btn.disabled = false;
            if (App.Flujos && App.Flujos.editor) App.Flujos.editor(null, d.borrador);
          }).catch(function (e) { App.fallo(e); btn.disabled = false; });
        } }, 'Armar un flujo');
        return App.filaDecision({ marca: quienMarca(x.agente), titulo: quienNombre(x.agente) + ' espera seguido a ' + quienNombre(x.esperaA),
          sub: x.veces + ' veces en el último mes · ¿armar un flujo?', principal: btn });
      }))));
    }).catch(function () { /* sin tarjeta */ });
  }

  /* la espera con la v1 que la dejó esperando: abre esa entrega, o la reunión si el pendiente es de una reunión */
  function abrirEspera(x) {
    if (!x) return;
    if (x.reunion && App.Reunion && App.Reunion.ver) App.Reunion.ver(x.reunion);
    else if (x.entregaParcial) App.Entregables.abrir(x.entregaParcial);
    else if (App.agente(x.agente)) App.Agente.abrir(x.agente, 'chat');
  }
  /* desde un aviso o un bloqueo que solo trae el id de la espera */
  function abrirEsperaPorId(id) {
    return api().get('/api/esperas', { estado: 'todas' }).then(function (r) {
      abrirEspera((r.esperas || []).filter(function (x) { return String(x.id) === String(id); })[0]);
    }).catch(App.fallo);
  }

  function filaEspera(x) {
    var ag = App.agente(x.agente);
    var estado = x.estado === 'lista' ? 'ya llegó, falta relanzar' : x.estado === 'relanzada' ? 'haciendo la versión completa' : (x.vencida ? 'vencida hace ' + diasTxt(x.dias) : App.hace(x.creada));
    return fila(ag || 'reloj', x.agenteNombre + ' espera a ' + x.esperaANombre, x.que + ' · ' + estado, null, 'Ver', function () { abrirEspera(x); });
  }

  function filaBloqueo(b, esperas) {
    var abre = b.tipo === 'espera' ? function () { var x = (esperas || {})[b.ref]; if (x) abrirEspera(x); else abrirEsperaPorId(b.ref); }
      : b.tipo === 'corrida' ? function () { if (App.Flujos && App.Flujos.verCorrida) App.Flujos.verCorrida(+b.ref); }
      : b.tipo === 'entrega' ? function () { App.Entregables.abrir(+b.ref); }
      : b.tipo === 'tarea' ? function () { var t = b.ref && b.ref.split(':')[0]; if (App.agente(t)) App.Agente.abrir(t, 'tareas'); } : null;
    return fila(b.tipo === 'corrida' ? 'flujo' : b.tipo === 'espera' ? 'reloj' : 'cerrar', b.texto, null,
      typeof b.dias === 'number' ? h('span.insignia.aviso', diasTxt(b.dias)) : null, 'Ver', abre);
  }

  function filaProxima(t) {
    var ag = App.agente(t.agente);
    return fila(ag || 'parte', t.nombre || t.tarea, (ag ? ag.nombre + ' · ' : '') + cuando(t.cuando), null, null, ag ? function () { App.Agente.abrir(t.agente, 'tareas'); } : null);
  }
  function cuando(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  /* «Qué pasó»: cifras grandes (entregas, tareas hechas, con error, gasto), lo que falló con su motivo y quién trabajó */
  function quePaso(p) {
    var cifras = [];
    var cifra = function (n, uno, varios, clase, alTocar) {
      if (!n) return;
      cifras.push(h((alTocar ? 'button' : 'div') + '.qp-cifra' + (clase ? '.' + clase : ''), alTocar ? { type: 'button', onclick: alTocar } : null,
        h('b', String(n)), h('span', n === 1 ? uno : varios)));
    };
    cifra(p.entregas, 'entrega nueva', 'entregas nuevas', null, function () { App.Nav.ir('#/bandeja/revisar'); });
    cifra(p.ejecucionesOk, 'tarea hecha', 'tareas hechas');
    cifra(p.ejecucionesError, 'tarea con error', 'tareas con error', 'error');
    cifra(p.pasosTerminados, 'paso de flujo', 'pasos de flujo');
    cifra(p.reunionesCerradas, 'reunión cerrada', 'reuniones cerradas');
    var hayCosto = typeof p.costo === 'number' && p.costo > 0;
    if (hayCosto) cifras.push(h('div.qp-cifra.costo', h('b', 'US$ ' + p.costo.toFixed(2)), h('span', 'gastado')));
    if (!cifras.length) return null;
    var out = [h('div.qp-cifras', cifras)];

    /* lo que falló: qué tarea, de quién y por qué */
    var errs = p.errores || [];
    if (errs.length) {
      out.push(h('div.qp-sub', 'Lo que falló'), h('div.qp-errores', errs.map(function (x) {
        var ag = x.agente && App.agente(x.agente);
        var esTarea = ag && ((App.E.oficina || {}).tareas || []).some(function (t) { return t.id === x.tarea; });
        return h((esTarea ? 'button' : 'div') + '.qp-error', esTarea ? { type: 'button', title: 'Ver las tareas de ' + ag.nombre, onclick: function () { App.Agente.abrir(ag.id, 'tareas'); } } : null,
          ag ? App.retratoImg(ag, 'retrato', 48) : h('span.qp-ico', App.icono('alerta')),
          h('div.qp-txt', h('b', x.nombre), h('span', (ag ? ag.nombre + ' · ' : '') + x.error)),
          h('span.qp-cuando', App.hace(x.cuando)));
      })));
    }

    /* quién trabajó: lo que gastó cada uno, con una barra a escala del que más gastó */
    var gastos = Object.keys(p.costoAgentes || {}).map(function (id) { return [id, p.costoAgentes[id]]; })
      .filter(function (x) { return x[1] > 0.005; }).sort(function (a, b) { return b[1] - a[1]; });
    if (gastos.length > 1) {
      var max = gastos[0][1];
      out.push(h('div.qp-sub', 'Quién trabajó'), h('div.qp-gastos', gastos.slice(0, 6).map(function (x) {
        var ag = App.agente(x[0]);
        return h('div.qp-gasto', ag ? App.retratoImg(ag, 'retrato', 48) : h('span.qp-ico', App.icono('personas')),
          h('span.qp-nombre', ag ? ag.nombre : App.humano.quien(x[0])),
          h('span.qp-barra', h('i', { style: { width: Math.max(4, Math.round(x[1] / max * 100)) + '%' } })),
          h('span.qp-monto', 'US$ ' + x[1].toFixed(2)));
      })));
    }
    return out;
  }

  /* ---------------- panel ---------------- */
  function pintar(p, pend) {
    var der = App.dom.derecho, cuerpo = h('div.der-cuerpo'), pie = h('div.der-pie');
    var necesita = p.teNecesita || [], rev = p.paraRevisar || { total: 0, entregas: [] }, flujos = p.flujos || [],
        bloq = p.bloqueos || [], esperas = p.esperas || [], prox = p.proximas || [], narrado = p.narrado && p.narrado.texto ? p.narrado : null;
    /* lo que te preguntaron o te propusieron en las charlas (docs/plan-recados.md, U3); las propuestas de acción van acá y
       no se repiten en «Para revisar» */
    pend = pend || {};
    var esperan = (pend.tarjetas || []), accionesP = (pend.acciones || []), cambiosP = (pend.cambios || []);
    var enEsperan = {};
    accionesP.forEach(function (a) { if (a.entrega) enEsperan[a.entrega] = true; });
    var entregas = (rev.entregas || []).filter(function (e) { return !enEsperan[e.id]; }).slice(0, 5);
    var vacio = !esperan.length && !accionesP.length && !cambiosP.length && !(App.Permisos && App.Permisos.cuantos()) && !necesita.length && !entregas.length && !flujos.length && !esperas.length && !bloq.length && !prox.length && !narrado;
    var desde = p.desde ? App.hace(p.desde) : '';
    App.add(App.vaciar(der), cabecera('Lo que te espera y lo que pasó' + (desde ? (desde === 'recién' ? ' desde recién' : ' desde ' + desde) : '')), cuerpo, pie);
    /* en el celular, una vez: instalar la app o prender los avisos (push.js) */
    var tjPush = App.Push && App.Push.tarjeta ? App.Push.tarjeta(function () { cargar(false); }) : null;
    if (tjPush) App.add(cuerpo, tjPush);
    /* primero lo urgente: los permisos que piden los agentes, con sus botones acá mismo */
    var perms = App.Permisos && App.Permisos.pendientes ? App.Permisos.pendientes() : [];
    if (perms.length) App.add(cuerpo, seccion('Te piden permiso', h('div.permisos-lista.en-hoy', perms.map(App.Permisos.tarjeta))));
    if (esperan.length || accionesP.length || cambiosP.length) {
      var op = { enBandeja: true, alCambiar: function () { cargar(false); } };
      App.add(cuerpo, seccion('Te esperan', [].concat(esperan.map(function (t) { return App.Tarjetas.de(t, op); }), accionesP.map(function (a) { return App.Tarjetas.accion(a, op); }),
        /* cambios en la oficina que propuso la secretaría, uno por charla (docs/plan-secretaria-creadora.md) */
        cambiosP.map(function (g) { return App.Tarjetas.cambios(g.tarjetas, { enBandeja: true, agente: g.agente, session: g.session, alCambiar: op.alCambiar }); }))));
    }

    var coord = coordinador();
    if (narrado) {
      App.add(cuerpo, h('div.parte-narrado', App.htmlSeguro(h('div.md-doc.doc-panel'), App.markdown(narrado.texto))));
    } else if (coord) {
      var btn = h('button.btn', { disabled: redactando, onclick: function () { redactar(coord, btn); } },
        redactando ? [h('span.giro'), coord.nombre + ' está redactando…'] : 'Pedile el parte a ' + coord.nombre);
      App.add(cuerpo, h('div.parte-pedir', btn));
      if (redactando) vigilar();
    }

    if (vacio) {
      App.add(cuerpo, h('div.nav-vacio', App.icono('ok'), h('b', 'Todo en orden'), h('p', 'No hay nada que te espere. Cuando un agente te entregue algo o te pida permiso, aparece acá.'),
        h('div.acciones', { style: { justifyContent: 'center' } },
          h('button.btn', { onclick: function (ev) { App.Nav.elegirAgente(ev.currentTarget, function (id) { App.Agente.nueva(id); }); } }, App.icono('charla'), 'Charlar con alguien'),
          h('button.btn.solo-compu', { onclick: function () { App.Reunion.nueva(); } }, App.icono('reunion'), 'Llamar a reunión'))));
    } else {
      if (necesita.length) App.add(cuerpo, seccion('Te necesita', h('div.parte-filas', necesita.map(filaAviso))));
      if (entregas.length) {
        App.add(cuerpo, seccion('Para revisar' + (rev.total > entregas.length ? ' (' + rev.total + ')' : ''),
          [App.Entregables.pintarTarjetas ? tarjetasHoy(entregas) : h('div.parte-filas', entregas.map(filaEntrega)),
            rev.total > entregas.length ? h('button.btn.chico.fantasma', { onclick: function () { App.Nav.ir('#/bandeja/revisar'); } }, 'Ver las ' + rev.total) : null]));
      }
      if (flujos.length) App.add(cuerpo, seccion('Flujos en curso', h('div.parte-filas', flujos.map(filaFlujo))));
      if (esperas.length) App.add(cuerpo, seccion('En espera', h('div.parte-filas', esperas.map(filaEspera))));
      pintarPatrones(cuerpo);
    }
    var qp = p.paso && quePaso(p.paso);
    if (qp) App.add(cuerpo, seccion('Qué pasó', qp));
    var porId = {};
    esperas.forEach(function (x) { porId[String(x.id)] = x; });
    if (bloq.length) App.add(cuerpo, seccion('Bloqueos', h('div.parte-filas', bloq.map(function (b) { return filaBloqueo(b, porId); }))));
    if (prox.length) App.add(cuerpo, seccion('Próximas tareas', h('div.parte-filas', prox.map(filaProxima))));

    var listo = h('button.btn.primario', { onclick: function () {
      listo.disabled = true;
      api().post('/api/parte/visto').then(function () { App.aviso('Listo: el próximo parte arranca desde acá.'); cargar(false); }).catch(function (e) { App.fallo(e); listo.disabled = false; });
    } }, 'Listo, ya lo vi');
    App.add(pie, App.acciones(null, listo));
  }

  function redactar(coord, btn) {
    btn.disabled = true;
    api().post('/api/parte/redactar').then(function () {
      redactando = true; intentos = 0;
      App.aviso(coord.nombre + ' se puso a redactar el parte.');
      if (App.Actividad) setTimeout(App.Actividad.ya, 300);
      cargar(false);
    }).catch(function (e) { App.fallo(e); btn.disabled = false; });
  }

  /* mientras redacta, se vuelve a pedir el parte cada 4 s (hasta 4 minutos) hasta que aparezca el narrado */
  function vigilar() {
    clearTimeout(reloj);
    if (++intentos > 60) { redactando = false; intentos = 0; return; }
    reloj = setTimeout(function () {
      if (!abiertoPanel() || !redactando) { redactando = false; intentos = 0; return; }
      api().get('/api/parte').then(function (p) {
        if (!abiertoPanel()) return;
        if (p.narrado && p.narrado.texto) { redactando = false; intentos = 0; pedido++; pintar(p); } else vigilar();
      }).catch(function () { vigilar(); });
    }, 4000);
  }

  return { abrir: abrir, alCerrarPanel: cerrarPanel, abrirEspera: abrirEsperaPorId, recargar: function () { cargar(false); } };
})();
