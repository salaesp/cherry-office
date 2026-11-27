/* «Te necesita»: avisos que llegan con /api/actividad. Faro sobre el agente en 3D, banner abajo al centro,
   tecla N para ir al siguiente, insignia del Dock (app nativa). Los de tipo reunión y propuestas se calculan en el
   servidor y desaparecen solos al resolverse (la reunión, también al abrirla); los demás se marcan como vistos al abrirlos. */
window.App = window.App || {};
App.Avisos = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var lista = [], indice = 0, banner = null, firma = '';
  /* los de tipo espera (entre agentes) también se calculan en el servidor: «visto» solo los apaga como aviso */
  var TITULO = { respuesta: ' te respondió', error: ' no pudo responder', tarea: ' terminó una tarea', permiso: ' necesita tu permiso' };

  function nombre(a) { var ag = a.agente && App.agente(a.agente); return ag ? ag.nombre : ''; }
  function titulo(a) {
    if (a.tipo === 'reunion') return 'Reunión esperándote';
    if (a.tipo === 'propuestas') return 'Propuesta de cambio en un documento';
    if (a.tipo === 'skill') return (nombre(a) || 'Un agente') + ' propone una skill';
    if (a.tipo === 'pendiente') return 'Pendientes para vos';
    if (a.tipo === 'flujo') return 'Te toca en un flujo';
    if (a.tipo === 'espera') {
      var m = /espera a ([^«(.]+?)\s*(?:\(|«|hace\b|\.|$)/.exec(a.texto || '');
      return (nombre(a) || 'Un agente') + ' espera' + (m ? ' a ' + m[1] : ' una entrega');
    }
    return (nombre(a) || 'Un agente') + (TITULO[a.tipo] || '');
  }
  function guardado(a) { return /^a\d+$/.test(a.id) || /^flujo:/.test(a.id); }

  /* con el panel de ese agente (o de esa reunión) abierto, ya se está viendo: se marca solo */
  function filtrar(avs) {
    var abierto = App.Agente && App.Agente.actual && App.Agente.actual();
    var panel = App.modoDerecho && App.modoDerecho() === 'agente';
    var reunion = App.Reunion && App.Reunion.abierta && App.Reunion.abierta();
    return avs.filter(function (a) {
      if (reunion && a.tipo === 'reunion' && a.ref === reunion) { App.api.post('/api/avisos/visto', { id: a.id }).catch(function () {}); return false; }
      if (panel && abierto && a.agente === abierto && guardado(a) && (a.tipo === 'respuesta' || a.tipo === 'error')) { visto({ agente: abierto }); return false; }
      return true;
    });
  }

  function aplicar(avs) {
    var f = JSON.stringify((avs || []).map(function (a) { return a.id + a.texto; }));
    lista = filtrar(avs || []);
    if (f === firma && banner) { pintarBanner(); return; }   // solo se refresca el «hace X min»
    firma = f;
    if (indice >= lista.length) indice = 0;
    var faros = {};
    lista.forEach(function (a) { if (a.agente) faros[a.agente] = a.tipo; });
    if (App.Oficina3D && App.Oficina3D.faros) App.Oficina3D.faros(faros);
    insignia();
    marcarLateral(faros);
    pintarBanner();
  }

  /* Dock: avisos «te necesita» + entregas sin revisar (las tareas terminadas ya no dejan aviso: no se cuenta dos veces) */
  function insignia() {
    var n = lista.length + (App.Entregables ? App.Entregables.sinRevisar() : 0);
    if (App.nativo && App.nativo.insignia) App.nativo.insignia(n);
  }

  function marcarLateral(faros) {
    var eq = App.dom && App.dom.equipo; if (!eq) return;
    eq.querySelectorAll('.persona[data-id]').forEach(function (el) { el.classList.toggle('con-aviso', !!faros[el.getAttribute('data-id')]); });
  }

  function pintarBanner() {
    var vista = App.dom && App.dom.lienzo && App.dom.lienzo.parentNode; if (!vista) return;
    if (!banner || !vista.contains(banner)) { banner = h('div.avisos-banner.oculto'); vista.appendChild(banner); }
    App.vaciar(banner);
    if (!lista.length) { banner.classList.add('oculto'); return; }
    banner.classList.remove('oculto');
    if (lista.length > 1) {
      /* varios: un resumen que lleva a Bandeja › Hoy, donde se ven todos juntos */
      banner.appendChild(h('span.avisos-faro'));
      banner.appendChild(h('div.avisos-txt', h('b', lista.length + ' te necesitan'), h('small', 'El más reciente: ' + (App.hace(lista.reduce(function (m, x) { return Math.max(m, x.creado || 0); }, 0)) || 'ahora'))));
      banner.appendChild(h('button.btn.chico.primario', { onclick: function () { if (App.Nav && App.Nav.ir) App.Nav.ir('#/bandeja/hoy'); } }, 'Ver'));
      return;
    }
    var a = lista[0];
    banner.appendChild(h('span.avisos-faro'));
    banner.appendChild(h('div.avisos-txt', h('b', titulo(a)), h('span', a.texto), h('small', App.hace(a.creado))));
    banner.appendChild(h('button.btn.chico.primario', { onclick: function () { abrir(a.id); } }, 'Ver'));
    if (guardado(a) || a.tipo === 'espera') banner.appendChild(h('button.btn.fantasma.icono', { title: 'Descartar', onclick: function () { visto({ id: a.id }); } }, App.icono('cerrar')));
  }

  function visto(d) {
    lista = lista.filter(function (a) { return d.id ? a.id !== d.id : !(d.agente && a.agente === d.agente && guardado(a)); });
    firma = '';
    aplicar(lista);
    return App.api.post('/api/avisos/visto', d).catch(function () {});
  }

  function abrir(id) {
    if (/^e\d+$/.test(id || '')) { if (App.Entregables) App.Entregables.abrir(+id.slice(1)); return; }   // notificación «te entregó»
    var a = lista.filter(function (x) { return x.id === id; })[0];
    if (!a) {  // desde una notificación: puede no estar en la lista todavía
      return App.api.get('/api/avisos').then(function (r) { lista = r.avisos || []; var b = lista.filter(function (x) { return x.id === id; })[0]; if (b) abrir(id); });
    }
    if (a.tipo === 'reunion') { if (a.ref && App.Reunion.ver) App.Reunion.ver(a.ref); else App.Reunion.abrir(); if (App.Oficina3D.enfocarLugar) App.Oficina3D.enfocarLugar('reunion'); return; }
    if (a.tipo === 'propuestas') { App.Biblioteca.abrir(); return; }
    if (a.tipo === 'skill') { if (App.SkillsPropias) App.SkillsPropias.revisar(a.agente, a.ref); return; }
    if (a.tipo === 'flujo') { visto({ id: a.id }); if (App.Flujos && App.Flujos.verCorrida) App.Flujos.verCorrida(a.ref); return; }
    if (a.tipo === 'espera') { visto({ id: a.id }); if (App.Parte && App.Parte.abrirEspera) App.Parte.abrirEspera(a.ref); return; }
    if (a.tipo === 'pendiente') { visto({ id: a.id }); if (App.Reunion.ver && a.ref) App.Reunion.ver(a.ref); else App.Reunion.abrir(); return; }
    if (a.agente && App.agente(a.agente)) {
      App.Agente.abrir(a.agente, 'chat');
      if (App.Oficina3D.enfocarAgente) App.Oficina3D.enfocarAgente(a.agente);
      visto({ agente: a.agente });
    } else visto({ id: a.id });
  }

  function siguiente() {
    if (!lista.length) {
      if (App.Entregables && App.Entregables.siguiente()) return;
      App.aviso('No hay nada pendiente.'); return;
    }
    indice = (indice + 1) % lista.length;
    var a = lista[indice];
    if (a.agente && App.Oficina3D.enfocarAgente) App.Oficina3D.enfocarAgente(a.agente);
    else if (a.tipo === 'reunion' && App.Oficina3D.enfocarLugar) App.Oficina3D.enfocarLugar('reunion');
    pintarBanner();
  }

  /* N: siguiente pendiente (si no estás escribiendo ni hay una hoja abierta) */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'n' && e.key !== 'N') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (App.hojaAbierta && App.hojaAbierta()) return;
    e.preventDefault();
    if (lista.length && banner && !banner.classList.contains('oculto') && lista.length === 1) abrir(lista[0].id); else siguiente();
  });

  if (App.on) App.on('actividad', function (r) { aplicar(r.avisos || []); });
  setInterval(function () { if (lista.length) pintarBanner(); }, 30000);

  return { abrir: abrir, siguiente: siguiente, insignia: insignia, vistoAgente: function (id) { return visto({ agente: id }); },
    // si el aviso todavía no llegó, lo apaga filtrar() cuando llegue (el panel sigue abierto)
    vistoReunion: function (id) { if (lista.some(function (a) { return a.id === 'reunion:' + id; })) visto({ id: 'reunion:' + id }); },
    lista: function () { return lista; } };
})();
