/* Recados a la secretaría (docs/plan-recados.md): le dejás un recado de texto o audio y ella decide qué hacer. El panel
   (modo «recados») muestra el hilo como tarjetas: tu recado (con la transcripción si fue audio), «Entendí: …», su
   respuesta y una tarjeta por cada cosa que hizo: delegación (con unos segundos para deshacer), propuesta de acción,
   pregunta con opciones. Los filtros (Todo · Te esperan · En curso · Hechos) van en la lista de la sección.
   El audio se graba con Web Audio y se manda como WAV 16 kHz mono: así no depende del formato de cada navegador.
   Usa GET/POST /api/recados y POST /api/recados/<id>/resultados/<rid>. */
window.App = window.App || {};
App.Recados = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var api = function () { return App.api; };
  var datos = null;          // última respuesta de GET /api/recados
  var filtro = 'todo';
  var pedido = 0, sondeo = null, reloj = null;
  var borrador = '';
  var grabacion = null;      // {stream, ctx, nodo, partes, inicio, timer}
  var vigia = null;

  var FILTROS = [
    { id: 'todo', texto: 'Todo', icono: 'charla' },
    { id: 'esperan', texto: 'Te esperan', icono: 'campana' },
    { id: 'curso', texto: 'En curso', icono: 'reloj' },
    { id: 'hechos', texto: 'Hechos', icono: 'ok' }
  ];
  var EN_CURSO = ['transcribiendo', 'en_cola', 'entendiendo', 'delegado'];
  var TE_ESPERAN = ['esperando_ok', 'esperando_respuesta'];

  function abiertoPanel() { return App.modoDerecho && App.modoDerecho() === 'recados'; }
  function deFiltro(r, f) {
    if (f === 'esperan') return TE_ESPERAN.indexOf(r.estado) >= 0;
    if (f === 'curso') return EN_CURSO.indexOf(r.estado) >= 0;
    if (f === 'hechos') return ['respondido', 'hecho', 'fallido'].indexOf(r.estado) >= 0;
    return true;
  }
  function cuenta(f) { return datos ? (datos.recados || []).filter(function (r) { return deFiltro(r, f); }).length : 0; }

  function abrir(f) {
    if (f && FILTROS.some(function (x) { return x.id === f; })) filtro = f;
    if (App.Agente && App.Agente.alCerrar) App.Agente.alCerrar();
    App.abrirDerecho('recados');
    cargar(true);
  }
  function alCerrarPanel() { clearTimeout(sondeo); sondeo = null; clearInterval(reloj); reloj = null; pedido++; cortarGrabacion(); }
  function ponerFiltro(f) {
    filtro = f;
    if (abiertoPanel()) { pintar(); App.Nav.alAbrir('recados'); } else abrir(f);
  }

  /* ---------------- datos ---------------- */
  function cargar(conGiro) {
    if (!abiertoPanel()) return;
    clearTimeout(sondeo);
    var n = ++pedido, der = App.dom.derecho;
    if (conGiro && !datos) App.add(App.vaciar(der), cabecera(), h('div.der-cuerpo', App.cargando('Trayendo los recados…')));
    api().get('/api/recados').then(function (r) {
      if (n !== pedido || !abiertoPanel()) return;
      datos = r;
      pintar();
      insignia();
      var vivo = (r.recados || []).some(function (x) {
        return ['transcribiendo', 'en_cola', 'entendiendo'].indexOf(x.fase) >= 0 ||
          (x.resultados || []).some(function (d) { return d.tipo === 'delegacion' && (d.estado === 'esperando' || d.estado === 'corriendo'); });
      });
      sondeo = setTimeout(refrescar, vivo ? 2000 : 15000);
    }).catch(function (e) {
      if (n !== pedido || !abiertoPanel()) return;
      App.add(App.vaciar(der), cabecera(), h('div.der-cuerpo', h('div.vacio', e.message)));
    });
  }
  function refrescar() {
    if (!abiertoPanel()) return;
    if (document.querySelector('.emergente, .velo') || grabacion) { sondeo = setTimeout(refrescar, 2000); return; }
    cargar(false);
  }
  /* la insignia de la sección: cuántos recados te esperan */
  function insignia() {
    var n = cuenta('esperan');
    var el = App.dom && App.dom.navRec;
    if (el) { el.textContent = n ? String(n) : ''; el.classList.toggle('oculto', !n); }
    if (App.Nav && App.Nav.seccion() === 'recados') App.Nav.pintarLista();
  }
  function vigilar() {
    clearInterval(vigia);
    var mirar = function () {
      if (abiertoPanel()) return;
      api().get('/api/recados').then(function (r) { datos = r; insignia(); }).catch(function () {});
    };
    vigia = setInterval(mirar, 30000);
    setTimeout(mirar, 1500);
  }

  /* ---------------- pintar ---------------- */
  function cabecera() {
    var sec = datos && datos.secretaria;
    return App.cabPanel({ icono: 'charla', titulo: 'Recados', sub: sec ? 'Para ' + sec.nombre + ' · secretaría' : 'Para la secretaría' });
  }
  function pintar() {
    var der = App.dom.derecho;
    var prev = der.querySelector('.der-cuerpo'), alFondo = !prev || prev.scrollHeight - prev.scrollTop - prev.clientHeight < 60, scroll = prev ? prev.scrollTop : 0;
    if (!datos.secretaria) {
      App.add(App.vaciar(der), cabecera(), h('div.der-cuerpo', App.vacio('charla', 'Todavía no hay secretaría',
        'Con la secretaría le podés dejar recados de texto o audio: los entiende, te contesta, propone acciones y le pasa trabajo al equipo.',
        [h('button.btn.primario', { onclick: function () { App.Ajustes.abrir('secretaria'); } }, 'Contratar la secretaría')])));
      return;
    }
    var lista = (datos.recados || []).slice().reverse().filter(function (r) { return deFiltro(r, filtro); });
    var cuerpo = h('div.der-cuerpo.rec-hilo');
    if (!lista.length) {
      cuerpo.appendChild(filtro === 'todo'
        ? App.vacio('charla', 'Dejale un recado a ' + datos.secretaria.nombre,
          'Escribí o grabá lo que necesites: «¿qué tengo mañana?», «decile a Marce que arme el presupuesto», «recordame el viernes llamar al contador».')
        : h('div.vacio', filtro === 'esperan' ? 'Nada te espera.' : filtro === 'curso' ? 'Nada en curso.' : 'Todavía no hay recados hechos.'));
    }
    lista.forEach(function (r) { cuerpo.appendChild(recado(r)); });
    var pie = h('div.der-pie.rec-pie');
    pintarRedactar(pie);
    App.add(App.vaciar(der), cabecera(), filtrosMovil(), cuerpo, pie);
    cuerpo.scrollTop = alFondo ? cuerpo.scrollHeight : scroll;
    clearInterval(reloj);
    if (der.querySelector('[data-empieza]')) reloj = setInterval(tictac, 1000);
  }
  /* en el celular, la lista de la sección no se ve con el panel abierto: los filtros van arriba del hilo */
  function filtrosMovil() {
    return h('div.rec-filtros', FILTROS.map(function (f) {
      var n = f.id === 'esperan' ? cuenta('esperan') : 0;
      return h('button.rec-filtro' + (filtro === f.id ? '.act' : ''), { onclick: function () { ponerFiltro(f.id); } }, f.texto, n ? h('span.n', String(n)) : null);
    }));
  }
  function tictac() {
    var hay = false;
    [].forEach.call(App.dom.derecho.querySelectorAll('[data-empieza]'), function (el) {
      var s = Math.max(0, Math.round(+el.getAttribute('data-empieza') - Date.now() / 1000));
      el.textContent = s > 0 ? 'Empieza en ' + s + ' s' : 'Empezando…';
      hay = true;
    });
    if (!hay) { clearInterval(reloj); reloj = null; }
  }

  var ESTADO_FASE = { transcribiendo: 'Transcribiendo el audio…', en_cola: 'En cola…', entendiendo: 'Leyendo tu recado…' };
  function hora(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es', { weekday: 'short', hour: '2-digit', minute: '2-digit' }); }

  function recado(r) {
    var sec = datos.secretaria;
    var partes = [];
    var burbuja = h('div.msg.u.rec-mio',
      r.audio ? botonAudio(r) : null,
      r.transcripcion ? h('div.rec-tx', r.transcripcion) : null,
      r.texto ? h('div', r.texto) : null,
      h('div.rec-hora', hora(r.creado) + (r.audio && r.transcripcion ? ' · transcripto en tu compu' : '')));
    partes.push(burbuja);
    if (ESTADO_FASE[r.fase]) partes.push(h('div.rec-fase', h('span.giro'), r.fase === 'entendiendo' ? sec.nombre + ' está leyendo tu recado…' : ESTADO_FASE[r.fase]));
    if (r.entendi) partes.push(h('div.rec-entendi', h('span', 'Entendí:'), h('b', r.entendi)));
    if (r.respuesta) partes.push(App.htmlSeguro(h('div.msg.a.rec-resp'), App.markdown(r.respuesta)));
    if (r.fase === 'fallido') partes.push(h('div.rec-error', App.icono('alerta'), h('span', r.error || 'No pudo procesar el recado.')));
    (r.resultados || []).forEach(function (x) { partes.push(x.tipo === 'pregunta' ? tarjetaPregunta(r, x) : tarjetaDelegacion(r, x)); });
    (r.acciones || []).forEach(function (ac) { partes.push(tarjetaAccion(ac)); });
    return h('div.rec', { 'data-id': r.id }, partes);
  }

  function botonAudio(r) {
    var b = h('button.rec-audio', { title: 'Escuchar', onclick: function () {
      b.disabled = true;
      api().get('/api/recados/' + r.id + '/audio').then(function (x) {
        var bin = atob(x.wav), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        var url = URL.createObjectURL(new Blob([arr], { type: 'audio/wav' })), a = new Audio(url);
        a.onended = function () { URL.revokeObjectURL(url); b.disabled = false; };
        a.play().catch(function () { b.disabled = false; });
      }).catch(function (e) { b.disabled = false; App.aviso(e.message, true); });
    } }, '▶', h('span', 'Nota de voz'));
    return b;
  }

  function tarjeta(clase, icono, cab, estado, cuerpo, botones) {
    return h('div.rec-tarj.' + clase,
      h('div.rec-tarj-cab', App.icono(icono), h('span', cab), estado ? h('span.rec-est', estado) : null),
      h('div.rec-tarj-cuerpo', cuerpo),
      botones && botones.length ? h('div.rec-tarj-pie', botones) : null);
  }
  function boton(texto, clase, accion) {
    return h('button.btn.chico' + (clase ? '.' + clase : ''), { onclick: function (ev) { var b = ev.currentTarget; b.disabled = true; Promise.resolve(accion()).finally(function () { b.disabled = false; }); } }, texto);
  }
  function decidir(r, x, accion, opcion) {
    var cuerpo = { accion: accion };
    if (opcion !== undefined) cuerpo.opcion = opcion;
    return api().post('/api/recados/' + r.id + '/resultados/' + x.id, cuerpo).then(function () { cargar(false); }).catch(function (e) { App.aviso(e.message, true); });
  }
  function nombreAgente(id) { var a = App.agente && App.agente(id); return a ? a.nombre : id; }

  var EST_DELEG = { propuesta: 'Te espera', esperando: '', corriendo: 'Trabajando', programada: 'Programado', hecha: 'Hecho', fallida: 'Falló', cancelada: 'Cancelado' };
  function tarjetaDelegacion(r, x) {
    var quien = nombreAgente(x.agente);
    var cab = x.estado === 'propuesta' ? '¿Se lo paso a ' + quien + '?' : x.estado === 'cancelada' ? 'No se lo pasé a ' + quien : 'Le pasé a ' + quien;
    var estado = x.estado === 'esperando' ? h('span', { 'data-empieza': x.empieza || 0 }, 'Empieza en…') : EST_DELEG[x.estado] || x.estado;
    var cuerpo = [h('div.rec-tit', x.nombre),
      h('details.rec-consigna', h('summary', 'Consigna'), h('div', x.consigna))];
    if (x.estado === 'programada' && x.cuando) cuerpo.push(h('div.rec-nota', 'Para el ' + x.cuando.fecha.split('-').reverse().join('/') + ' a las ' + x.cuando.hora + '.'));
    if (x.estado === 'fallida' && x.error) cuerpo.push(h('div.rec-nota.error', x.error));
    var bs = [];
    if (x.estado === 'propuesta') bs.push(boton('Descartar', 'fantasma', function () { return decidir(r, x, 'descartar'); }), boton('Pasárselo', 'primario', function () { return decidir(r, x, 'confirmar'); }));
    if (x.estado === 'esperando') bs.push(boton('Deshacer', '', function () { return decidir(r, x, 'cancelar'); }), boton('Empezar ya', 'primario', function () { return decidir(r, x, 'ya'); }));
    if (x.estado === 'programada') bs.push(boton('Cancelar', 'fantasma', function () { return decidir(r, x, 'cancelar'); }));
    if (x.entrega) bs.push(boton('Ver lo que entregó', x.estado === 'hecha' ? 'primario' : '', function () { App.Entregables.abrir(x.entrega); }));
    return tarjeta('deleg' + (x.estado === 'cancelada' ? '.apagada' : ''), 'flecha', cab, estado, cuerpo, bs);
  }

  function tarjetaPregunta(r, x) {
    var abierta = x.estado === 'abierta';
    var ops = (x.opciones || []).map(function (o, i) {
      return h('button.rec-opcion' + (x.elegida === i ? '.elegida' : ''), { disabled: !abierta, onclick: function (ev) { ev.currentTarget.disabled = true; decidir(r, x, 'responder', i); } },
        h('b', o.texto), o.detalle ? h('small', o.detalle) : null);
    });
    return tarjeta('preg' + (abierta ? '' : '.apagada'), 'bombilla', 'Te pregunto', abierta ? 'Te espera' : 'Respondida',
      [h('div.rec-tit', x.texto), ops.length ? h('div.rec-opciones', ops) : null, abierta ? h('div.rec-nota', 'Tocá una opción o contestale con tus palabras.') : null]);
  }

  var EST_ACCION = { pendiente: 'Te espera', aprobada: 'Aprobada', ejecutando: 'Haciéndolo', hecha: 'Hecha', ejecutada: 'Hecha', descartada: 'Descartada', fallida: 'Falló', error: 'Falló' };
  function tarjetaAccion(ac) {
    var bs = ac.entrega ? [boton(ac.estado === 'pendiente' ? 'Revisar y aprobar' : 'Ver', ac.estado === 'pendiente' ? 'primario' : '', function () { App.Entregables.abrir(ac.entrega); })] : [];
    return tarjeta('accion' + (ac.estado === 'descartada' ? '.apagada' : ''), 'calendario', 'Propuesta', EST_ACCION[ac.estado] || ac.estado,
      [h('div.rec-tit', ac.resumen), App.Propuestas ? App.Propuestas.tarjeta(ac) : null], bs);
  }

  /* ---------------- redactar y grabar ---------------- */
  function pintarRedactar(pie) {
    var nombre = datos.secretaria.nombre;
    if (grabacion) {
      var t = h('span.rec-tiempo', '0:00');
      grabacion.etiqueta = t;
      App.add(pie, h('div.redactar.rec-grabando',
        h('button.btn.fantasma', { onclick: cortarGrabacion }, 'Cancelar'),
        h('div.rec-vumetro', h('span.rec-punto'), t, h('span', 'Grabando…')),
        h('button.btn.primario', { onclick: terminarGrabacion }, App.icono('enviar'), 'Mandar')));
      actualizarTiempo();
      return;
    }
    var txt = h('textarea.campo', { rows: 1, placeholder: 'Dejale un recado a ' + nombre + '…', maxlength: 4000 });
    var enviar = h('button.btn.primario.icono', { title: 'Mandar (Enter)', onclick: mandar }, App.icono('enviar'));
    var mic = h('button.btn.icono.rec-mic', { title: 'Grabar un audio', onclick: empezarGrabacion }, iconoMic());
    txt.value = borrador;
    function alto() { txt.style.height = 'auto'; txt.style.height = Math.min(160, txt.scrollHeight + 2) + 'px'; }
    txt.addEventListener('input', function () { borrador = txt.value; alto(); });
    txt.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); mandar(); } });
    if (borrador) setTimeout(alto, 0);
    App.add(pie, h('div.redactar', mic, txt, enviar),
      h('div.ayuda', 'Enter para mandar · Mayús+Enter para otra línea · el audio se transcribe en tu compu'));
    function mandar() {
      var t = txt.value.trim();
      if (!t) { txt.focus(); return; }
      enviar.disabled = true;
      api().post('/api/recados', { texto: t }).then(function () {
        borrador = ''; txt.value = '';
        if (filtro !== 'todo') filtro = 'todo';
        cargar(false);
      }).catch(function (e) { App.aviso(e.message, true); }).finally(function () { enviar.disabled = false; });
    }
  }
  function iconoMic() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.7'); s.setAttribute('stroke-linecap', 'round');
    s.innerHTML = '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>';
    return s;
  }

  function empezarGrabacion() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { App.aviso('Este navegador no deja grabar audio.', true); return; }
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      var fuente = ctx.createMediaStreamSource(stream);
      var nodo = ctx.createScriptProcessor(4096, 1, 1);
      var g = { stream: stream, ctx: ctx, nodo: nodo, fuente: fuente, partes: [], inicio: Date.now(), frecuencia: ctx.sampleRate };
      nodo.onaudioprocess = function (e) { g.partes.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
      fuente.connect(nodo); nodo.connect(ctx.destination);
      grabacion = g;
      g.timer = setInterval(actualizarTiempo, 250);
      pintar();
    }).catch(function () { App.aviso('No pude usar el micrófono: revisá el permiso.', true); });
  }
  function actualizarTiempo() {
    if (!grabacion) return;
    var s = Math.floor((Date.now() - grabacion.inicio) / 1000);
    var max = (datos && datos.maxSegundosAudio) || 300;
    if (grabacion.etiqueta) grabacion.etiqueta.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    if (s >= max) terminarGrabacion();
  }
  function soltar(g) {
    clearInterval(g.timer);
    try { g.fuente.disconnect(); g.nodo.disconnect(); } catch (e) {}
    g.stream.getTracks().forEach(function (t) { t.stop(); });
    try { g.ctx.close(); } catch (e) {}
  }
  function cortarGrabacion() {
    if (!grabacion) return;
    var g = grabacion; grabacion = null;
    soltar(g);
    if (abiertoPanel() && datos) pintar();
  }
  function terminarGrabacion() {
    if (!grabacion) return;
    var g = grabacion; grabacion = null;
    soltar(g);
    var wav = aWav(g.partes, g.frecuencia);
    pintar();
    if (!wav) { App.aviso('El audio quedó vacío.', true); return; }
    api().post('/api/recados', { audio: { wav: wav } }).then(function () { filtro = 'todo'; cargar(false); })
      .catch(function (e) { App.aviso(e.message, true); });
  }
  /* PCM float a WAV 16 kHz mono 16 bits, en base64 */
  function aWav(partes, frecuencia) {
    var n = partes.reduce(function (s, p) { return s + p.length; }, 0);
    if (n < frecuencia * 0.3) return null;
    var todo = new Float32Array(n), o = 0;
    partes.forEach(function (p) { todo.set(p, o); o += p.length; });
    var razon = frecuencia / 16000, m = Math.floor(n / razon);
    var buf = new ArrayBuffer(44 + m * 2), v = new DataView(buf);
    var esc = function (off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    esc(0, 'RIFF'); v.setUint32(4, 36 + m * 2, true); esc(8, 'WAVE'); esc(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
    v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); esc(36, 'data'); v.setUint32(40, m * 2, true);
    for (var k = 0; k < m; k++) {
      // promedio del tramo (filtro simple contra el aliasing al bajar la frecuencia)
      var a = Math.floor(k * razon), b = Math.max(a + 1, Math.floor((k + 1) * razon)), s = 0;
      for (var j = a; j < b && j < n; j++) s += todo[j];
      var x = Math.max(-1, Math.min(1, s / (b - a)));
      v.setInt16(44 + k * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
    var bytes = new Uint8Array(buf), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  return {
    abrir: abrir, alCerrarPanel: alCerrarPanel, ponerFiltro: ponerFiltro, filtro: function () { return filtro; },
    FILTROS: FILTROS, cuenta: cuenta, vigilar: vigilar, aWav: aWav
  };
})();
