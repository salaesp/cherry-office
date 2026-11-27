/* Tareas: panel derecho en modo «tareas» con las tareas programadas de toda la oficina, no de un agente.
   Usa GET /api/tareas (ya trae todas) y las agrupa: corriendo, esperando tu permiso, con error, por hacer (por fecha),
   en pausa y hechas. Editar y crear reusan la hoja de la ficha del agente (App.Agente.editarTarea / nuevaTarea). */
window.App = window.App || {};
App.Tareas = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var api = function () { return App.api; };
  var pedido = 0;           // para descartar respuestas viejas
  var sondeo = null;        // mientras el panel está abierto
  var vigia = null;         // insignia de la barra lateral
  var verHechas = false;

  function abiertoPanel() { return App.modoDerecho && App.modoDerecho() === 'tareas'; }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

  function abrir() {
    if (App.Agente && App.Agente.alCerrar) App.Agente.alCerrar();
    App.abrirDerecho('tareas');
    cargar(true);
  }
  function cerrarPanel() { clearTimeout(sondeo); sondeo = null; pedido++; }

  function cabecera(sub) {
    return App.cabPanel({ icono: 'reloj', titulo: 'Tareas', sub: sub });
  }

  function cargar(conGiro) {
    if (!abiertoPanel()) return;
    clearTimeout(sondeo);
    var n = ++pedido, der = App.dom.derecho;
    if (conGiro) App.add(App.vaciar(der), cabecera(''), h('div.der-cuerpo', App.cargando('Trayendo las tareas…')));
    api().get('/api/tareas').then(function (r) {
      if (n !== pedido || !abiertoPanel()) return;
      var ts = r.tareas || [];
      pintar(ts);
      insignia(ts);
      // mientras alguna corre, cada 3 s; si no, cada 30 s (para que «próxima» y los estados no queden viejos)
      var corre = ts.some(function (t) { return t.corriendo; });
      sondeo = setTimeout(refrescar, corre ? 3000 : 30000);
    }).catch(function (e) {
      if (n !== pedido || !abiertoPanel()) return;
      App.add(App.vaciar(der), cabecera(''), h('div.der-cuerpo', h('div.vacio', e.message)));
    });
  }
  /* el refresco solo no repinta con un menú o una hoja abiertos (dejaría el menú suelto): reintenta en 2 s */
  function refrescar() {
    if (!abiertoPanel()) return;
    if (document.querySelector('.emergente, .velo')) { sondeo = setTimeout(refrescar, 2000); return; }
    cargar(false);
  }
  function recargarDespues() { cargar(false); if (App.Actividad) setTimeout(App.Actividad.ya, 300); }

  /* ---------------- clasificación ---------------- */
  function grupo(t) {
    var activa = t.activa !== false, unica = t.tipo === 'unica';
    if (t.corriendo) return 'corriendo';
    if (t.ultima && t.ultima.estado === 'esperando_permiso') return 'permiso';
    if (unica && t.hecha) return 'hechas';
    if (!activa) return 'pausa';
    if (t.ultima && t.ultima.estado === 'error' && !t.ultima.manual && (unica || !t.proxima)) return 'error';
    return 'proximas';
  }
  function instante(t) {
    var iso = t.proxima || t.cuando;
    var d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.getTime() : Infinity;
  }

  /* ---------------- textos ---------------- */
  var DIAS_CORTO = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  function textoDias(dias) {
    var d = (dias || []).slice().sort().join(',');
    if (d === '1,2,3,4,5') return 'lun a vie';
    if (d === '1,2,3,4,5,6,7') return 'todos los días';
    if (d === '6,7') return 'fines de semana';
    return (dias || []).slice().sort().map(function (n) { return DIAS_CORTO[n]; }).join(', ');
  }
  function mismoDia(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  /* «hoy 08:00», «mañana 08:00», «jue 20 nov 08:00» (en la hora de esta compu) */
  function cuando(iso) {
    var d = iso ? new Date(iso) : null; if (!d || isNaN(d)) return '';
    var hoy = new Date(), man = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
    var hora = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    if (mismoDia(d, hoy)) return 'hoy ' + hora;
    if (mismoDia(d, man)) return 'mañana ' + hora;
    return d.toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hora;
  }
  /* « · Opus · Máximo» si la tarea tiene modelo o esfuerzo propios (pisan los del agente) */
  function textoIA(t) {
    var ia = t.ia || {}, p = [];
    if (ia.modelo) p.push(App.tituloModelo(ia.modelo));
    if (ia.esfuerzo) p.push(App.tituloEsfuerzo(ia.esfuerzo));
    return p.length ? ' · ' + p.join(' · ') : '';
  }
  function cadencia(t) { return t.tipo === 'unica' ? 'una sola vez' : textoDias(t.dias) + ' · ' + t.hora; }

  function detalle(t, g) {
    switch (g) {
      case 'corriendo': return 'Trabajando en esto ahora';
      case 'permiso': return 'Frenó: necesita tu permiso para seguir';
      case 'error': return 'Falló ' + (t.ultima && t.ultima.inicio ? App.hace(t.ultima.inicio) : '') + (t.tipo === 'unica' ? ' · no se reintenta sola' : '');
      case 'hechas': return 'Hecha ' + (t.hecha ? App.hace(t.hecha) : '');
      case 'pausa': return 'En pausa · ' + cadencia(t);
      default:
        if (t.proxima) return cuando(t.proxima) + ' · ' + cadencia(t);
        if (t.tipo === 'unica') return 'Ya es la hora: se hace en cuanto se pueda';
        return 'Sin próxima corrida · ' + cadencia(t);
    }
  }

  /* ---------------- filas ---------------- */
  /* misma forma que las de la ficha: retrato · nombre · bajada · estado · UN botón principal · «⋯» */
  function fila(t, g) {
    var ag = App.agente(t.agente);
    var unica = t.tipo === 'unica', activa = t.activa !== false;
    var abrirFicha = function () { if (ag) App.Agente.abrir(t.agente, 'tareas'); };

    var principal = null;
    if (g !== 'corriendo' && g !== 'permiso') {
      principal = h('button.btn.chico', { title: unica ? 'Hacerla ahora' : 'Correrla ahora, fuera de horario', onclick: function () {
        principal.disabled = true;
        api().post('/api/tareas/' + encodeURIComponent(t.id) + '/correr').then(function () {
          App.aviso((ag ? ag.nombre + ' se puso con' : 'Corriendo') + ' «' + t.nombre + '».');
          recargarDespues();
        }).catch(function (e) { App.fallo(e); principal.disabled = false; });
      } }, g === 'hechas' ? 'Hacer de nuevo' : (unica ? 'Hacer ahora' : 'Correr ahora'));
    } else if (ag) {
      principal = h('button.btn.chico', { onclick: abrirFicha }, g === 'permiso' ? 'Revisar' : 'Ver');
    }

    var mas = [];
    if (ag) mas.push({ texto: 'Editar…', icono: 'lapiz', accion: function () { App.Agente.editarTarea(t, function () { cargar(false); }); } });
    if (ag) mas.push({ texto: 'Ver en la ficha de ' + ag.nombre, icono: 'personas', accion: abrirFicha });
    if (g !== 'hechas') mas.push({ texto: activa ? 'Pausar' : 'Reanudar', icono: 'reloj', accion: function () {
      api().patch('/api/tareas/' + encodeURIComponent(t.id), { activa: !activa }).then(function () {
        App.aviso(activa ? 'Tarea en pausa.' : 'Tarea reanudada.'); cargar(false);
      }).catch(App.fallo);
    } });
    mas.push('-');
    mas.push({ texto: 'Borrar…', icono: 'cerrar', peligro: true, accion: function () {
      App.confirmar('¿Borrar «' + t.nombre + '»?', 'Deja de correr y se borra su historial de ejecuciones. Las conversaciones que ya generó quedan en el chat' + (ag ? ' de ' + ag.nombre : '') + '.', 'Borrar', true).then(function (si) {
        if (!si) return;
        api().del('/api/tareas/' + encodeURIComponent(t.id)).then(function () { App.aviso('Tarea borrada.'); cargar(false); }).catch(App.fallo);
      });
    } });

    var estado = g === 'corriendo' ? h('span.insignia.aviso', h('span.giro'), 'Corriendo')
      : g === 'permiso' ? h('span.insignia.aviso', 'Tu permiso')
      : g === 'error' ? h('span.insignia.error', 'Con error') : null;

    var el = App.filaDecision({ marca: ag || 'reloj', titulo: t.nombre, clase: 'tarea-fila', alTocar: ag ? abrirFicha : null,
      sub: (ag ? ag.nombre : App.humano.quien(t.agente)) + ' · ' + detalle(t, g) + textoIA(t), estado: estado, principal: principal, mas: mas });
    if (g === 'pausa' || g === 'hechas') el.style.opacity = 0.75;
    return el;
  }

  function seccion(titulo, filas, ayuda) { return App.seccion(titulo, filas, { ayuda: ayuda }); }

  /* ---------------- panel ---------------- */
  function pintar(ts) {
    var der = App.dom.derecho, cuerpo = h('div.der-cuerpo'), pie = h('div.der-pie');
    var g = { corriendo: [], permiso: [], error: [], proximas: [], pausa: [], hechas: [] };
    ts.forEach(function (t) { g[grupo(t)].push(t); });
    g.proximas.sort(function (a, b) { return instante(a) - instante(b); });
    g.hechas.sort(function (a, b) { return String(b.hecha || '').localeCompare(String(a.hecha || '')); });

    var sub = [];
    if (g.corriendo.length) sub.push(plural(g.corriendo.length, 'corriendo', 'corriendo'));
    if (g.proximas.length) sub.push(plural(g.proximas.length, 'por hacer', 'por hacer'));
    if (g.permiso.length) sub.push(plural(g.permiso.length, 'esperando permiso', 'esperando permiso'));
    App.add(App.vaciar(der), cabecera(sub.join(' · ')), cuerpo, pie);

    if (!ts.length) {
      App.add(cuerpo, App.vacio('reloj', 'Todavía no hay tareas', 'Programale a un agente algo que haga solo: un informe cada mañana, o un encargo de una sola vez. Usá «Nueva tarea», abajo.'));
    } else {
      var ahora = Date.now(), finHoy = new Date(); finHoy.setHours(23, 59, 59, 999);
      var hoy = g.proximas.filter(function (t) { return instante(t) <= finHoy.getTime(); });
      var semana = g.proximas.filter(function (t) { var i = instante(t); return i > finHoy.getTime() && i <= ahora + 7 * 864e5; });
      var despues = g.proximas.filter(function (t) { return instante(t) > ahora + 7 * 864e5; });
      /* lo que antes era un párrafo fijo al pie va como ayuda de la primera sección */
      var ayuda = 'Las tareas corren mientras Oficina está abierta (aunque cierres la ventana). Las horas son las de esta compu.';
      var sec = function (titulo, filas) { var x = seccion(titulo, filas, ayuda); ayuda = null; App.add(cuerpo, x); };
      if (g.corriendo.length) sec('Corriendo ahora', g.corriendo.map(function (t) { return fila(t, 'corriendo'); }));
      if (g.permiso.length) sec('Esperan tu permiso', g.permiso.map(function (t) { return fila(t, 'permiso'); }));
      if (g.error.length) sec('Con error', g.error.map(function (t) { return fila(t, 'error'); }));
      if (hoy.length) sec('Hoy', hoy.map(function (t) { return fila(t, 'proximas'); }));
      if (semana.length) sec('Próximos 7 días', semana.map(function (t) { return fila(t, 'proximas'); }));
      if (despues.length) sec('Más adelante', despues.map(function (t) { return fila(t, 'proximas'); }));
      if (g.pausa.length) sec('En pausa', g.pausa.map(function (t) { return fila(t, 'pausa'); }));
      if (g.hechas.length) {
        var btn = h('button.btn.chico.fantasma', { onclick: function () { verHechas = !verHechas; cargar(false); } },
          verHechas ? 'Ocultar' : (g.hechas.length === 1 ? 'Ver la que ya se hizo' : 'Ver las ' + g.hechas.length + ' que ya se hicieron'));
        App.add(cuerpo, App.seccion('Hechas', verHechas ? g.hechas.map(function (t) { return fila(t, 'hechas'); }) : null, { cuenta: String(g.hechas.length), accion: btn, ayuda: ayuda }));
      }
    }

    var nueva = h('button.btn.primario', { onclick: function (ev) { elegirAgente(ev.currentTarget); } }, App.icono('mas'), 'Nueva tarea');
    App.add(pie, App.acciones(null, nueva));
  }

  /* «Nueva tarea»: primero a quién (la hoja es la de la ficha del agente) */
  function elegirAgente(ancla) {
    var ags = (App.E.oficina && App.E.oficina.agentes) || [];
    if (!ags.length) { App.aviso('Primero contratá un agente.', true); return; }
    var listo = function () { cargar(false); };
    /* la hoja elige el agente arriba, con sus caras (si hay uno solo, ya viene elegido) */
    App.Agente.nuevaTarea(ags.length === 1 ? ags[0].id : null, {}, listo);
  }

  /* ---------------- insignia en la barra lateral ---------------- */
  function insignia(ts) {
    var b = App.dom && App.dom.navTar; if (!b) return;
    var corre = ts.filter(function (t) { return t.corriendo; }).length;
    var traba = ts.filter(function (t) { var g = grupo(t); return g === 'permiso' || g === 'error'; }).length;
    b.className = 'insignia' + (traba ? ' aviso' : corre ? ' info' : ' oculto');
    b.textContent = traba ? String(traba) : corre ? 'Corriendo' : '';
    b.title = traba ? plural(traba, 'tarea trabada', 'tareas trabadas') : '';
  }
  /* cada 30 s, aunque el panel esté cerrado (si está abierto, la insignia la pone cargar) */
  function vigilar() {
    clearTimeout(vigia);
    vigia = setTimeout(function tic() {
      if (!abiertoPanel()) api().get('/api/tareas').then(function (r) { insignia(r.tareas || []); }).catch(function () {});
      vigia = setTimeout(tic, 30000);
    }, abiertoPanel() ? 30000 : 0);
  }

  return { abrir: abrir, alCerrarPanel: cerrarPanel, vigilar: vigilar };
})();
