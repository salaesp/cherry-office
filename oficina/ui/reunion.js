/* Reuniones: los agentes van a la sala, opinan por rondas desde su rol, les escribís como en un chat y al cerrar queda un acta. */
(function () {
  'use strict';
  var h = App.h, api = App.api;
  var E = App.E;
  var visto = null;         // id de la reunión que muestra el panel
  var reloj = null, vigilando = null, cerrando = false, resumiendo = null;
  var borrador = {};        // lo que estás escribiendo, por reunión (el panel se repinta mientras hablan)

  /* patrones de reunión: misma lista y mismos ids que el backend (ReunionPatrones.swift / hq_reuniones.py) */
  var PATRONES = [
    { id: 'debate', nombre: 'Debate', txt: 'Hablan uno tras otro y cada uno responde a lo que se dijo antes.' },
    { id: 'lider', nombre: 'Líder y equipo', txt: 'El líder abre y encuadra, el equipo opina y el líder cierra con su posición.' },
    { id: 'mapreduce', nombre: 'Opiniones independientes', txt: 'Todos responden a la vez sin ver a los demás; después se sintetiza.' },
    { id: 'redblue', nombre: 'Dos bandos', txt: 'Un bando defiende la propuesta y el otro la critica, alternándose.' },
    { id: 'revision', nombre: 'Panel de revisión', txt: 'Cada uno revisa los documentos adjuntos desde su rol: hallazgos, riesgos y cambios.' }
  ];
  function patronDe(id) { return PATRONES.filter(function (p) { return p.id === id; })[0] || PATRONES[0]; }
  function slug(t) {
    var s = (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s.length > 41 ? s.slice(0, 41).replace(/-+$/, '') : s;
  }
  function salidaSugerida(tema) {
    var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'archivos/entregables/reuniones/' + d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + '-' + (slug(tema) || 'reunion') + '.md';
  }

  function activa(r) { return r && (r.estado === 'en_curso' || r.estado === 'esperando'); }

  /* ---------------- lista ---------------- */
  /* la sala de reuniones (maqueta, ⌘K): con una en curso se abre esa; si no, se llama a una nueva.
     La lista de reuniones vive en Charlas (nav.js). */
  function abrir() {
    if (activa(E.reunion)) { panel(E.reunion.id); return; }
    nueva();
  }
  function nombre(id) { var a = App.agente(id); return a ? a.nombre : id; }

  /* ---------------- nueva ---------------- */
  /* `con`: ids que arrancan elegidos (p. ej. desde la ficha de un agente). Es una pantalla con ruta (#/equipo/nueva-reunion) */
  function nueva(con) {
    if (activa(E.reunion)) { App.aviso('Ya hay una reunión en curso.'); panel(E.reunion.id); return; }
    var o = E.oficina;
    if (o.agentes.length < 2) { App.aviso('Para una reunión hacen falta al menos dos agentes.', true); return; }
    var hj = App.hojaEnPanel({ titulo: 'Llamar a reunión', icono: 'reunion', sub: 'Ponele un título, elegí quiénes participan y cómo se habla' }, 'reunion-nueva');
    function cancelar() { if (App.Nav && App.Nav.ir) App.Nav.ir('#/equipo/reuniones'); else hj.cerrar(); }
    var titulo = h('input.campo', { type: 'text', maxlength: 120, autofocus: true, placeholder: 'Ej.: Lanzamiento de la colección de verano' });
    var tema = h('textarea.campo', { rows: 4, maxlength: 1000, placeholder: 'Opcional: contexto, objetivos y lo que haga falta. Ej.: presupuesto, canales, fechas y qué queremos decidir hoy.' });
    var elegidos = [], grilla = h('div.elegir-agentes');
    o.agentes.forEach(function (a) {
      var b = h('button.elegible', { type: 'button', onclick: function () {
        var i = elegidos.indexOf(a.id);
        if (i >= 0) elegidos.splice(i, 1); else if (elegidos.length < 10) elegidos.push(a.id); else App.aviso('Hasta 10 por reunión.');
        b.classList.toggle('sel', elegidos.indexOf(a.id) >= 0);
        extras();
      } }, App.retratoImg(a, 'retrato', 72), h('div', { style: { minWidth: 0 } }, h('div.persona-nombre', a.nombre), h('div.persona-rol', a.rol)));
      grilla.appendChild(b);
      if (Array.isArray(con) && con.indexOf(a.id) >= 0) { elegidos.push(a.id); b.classList.add('sel'); }
    });
    var rondas = App.elegir({ etiqueta: 'Rondas', valor: 1, forma: 'deslizador',
      opciones: [1, 2, 3].map(function (n) { return { valor: n, titulo: n === 1 ? 'Una ronda' : n + ' rondas' }; }) });
    var docs = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }), docsSel = [];
    var err = h('div.error-txt');
    /* patrón, líder o bandos según el patrón, y archivo de salida */
    var bando = {}, editoSalida = false, lider = null;
    var patron = App.elegir({ etiqueta: 'Tipo de reunión', forma: 'lista', valor: PATRONES[0].id, alCambiar: function () { extras(); },
      opciones: PATRONES.filter(function (p) { return p.id !== 'revision'; }).map(function (p) { return { valor: p.id, titulo: p.nombre, sub: p.txt }; }) });
    var liderCaja = h('div'), liderFila = h('div.fila-campo.oculto', h('label.etiqueta-campo', 'Líder'), h('div.ayuda', 'Abre y encuadra la reunión, y la cierra con su posición.'), liderCaja);
    var bandosCaja = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    var bandosFila = h('div.fila-campo.oculto', h('label.etiqueta-campo', 'Bandos'),
      h('div.ayuda', 'A defiende la propuesta del tema; B la critica. Tiene que haber al menos uno en cada bando.'), bandosCaja);
    var salida = h('input.campo', { type: 'text', maxlength: 200, value: salidaSugerida(''), oninput: function () { editoSalida = true; } });
    function extras() {
      var rev = revisar.valor();
      tipoFila.classList.toggle('atenuado', rev);
      var p = rev ? '' : patron.valor();
      liderFila.classList.toggle('oculto', p !== 'lider');
      bandosFila.classList.toggle('oculto', p !== 'redblue');
      if (lider && elegidos.indexOf(lider) < 0) lider = null;
      if (!lider && elegidos.length) lider = elegidos[0];
      App.vaciar(liderCaja);
      if (!elegidos.length) liderCaja.appendChild(h('span.ayuda', 'Elegí primero a los participantes.'));
      else liderCaja.appendChild(App.elegir({ etiqueta: 'Líder', forma: 'chips', valor: lider, alCambiar: function (v) { lider = v; },
        opciones: elegidos.map(function (id) { var a = App.agente(id); return { valor: id, titulo: nombre(id), retrato: a }; }) }));
      App.vaciar(bandosCaja);
      elegidos.forEach(function (id, i) {
        if (!bando[id]) bando[id] = i % 2 === 0 ? 'a' : 'b';
        var fila = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('span', { style: { flex: 1 } }, nombre(id)));
        ['a', 'b'].forEach(function (k) {
          var bt = h('button.btn.chico' + (bando[id] === k ? '.primario' : ''), { type: 'button', onclick: function () { bando[id] = k; extras(); } }, k.toUpperCase());
          fila.appendChild(bt);
        });
        bandosCaja.appendChild(fila);
      });
    }
    titulo.addEventListener('input', function () { if (!editoSalida) salida.value = salidaSugerida(titulo.value); });
    var docsAviso = h('div.ayuda.oculto');
    /* modelo y esfuerzo de toda la reunión: por defecto, los de cada agente. Cada turno lee lo dicho hasta ahí, así que
       una reunión larga con mucho esfuerzo gasta bastante */
    var modeloReu = App.elegir({ etiqueta: 'Modelo', forma: 'deslizador', valor: '',
      opciones: [{ valor: '', titulo: 'El de cada agente', aparte: true }].concat(App.MODELO_ESCALA.map(function (v) { var m = App.MODELOS.filter(function (x) { return x.valor === v; })[0]; return { valor: m.valor, titulo: m.titulo, sub: m.sub }; })) });
    var memoriaReu = App.elegir({ etiqueta: 'Memoria', forma: 'interruptor', valor: App.iaApp().memoria,
      opciones: App.opcionIA('memoria').opciones.map(function (x) { return { valor: x.valor, titulo: x.titulo }; }) });
    var esfuerzoReu = App.elegir({ etiqueta: 'Esfuerzo', forma: 'deslizador', valor: '',
      opciones: App.ESFUERZOS.map(function (m) { return { valor: m.valor, titulo: m.valor === '' ? 'El de cada agente' : m.titulo, sub: m.sub, aparte: m.valor === '' }; }) });
    /* Panel de revisión: no es una forma de hablar sino un propósito; prendido, la reunión revisa los documentos
       adjuntos (manda patron 'revision') y deja de lado el tipo de reunión. */
    var revisar = App.elegir({ etiqueta: 'Panel de revisión', forma: 'interruptor', valor: false,
      opciones: [{ valor: true, titulo: 'Cada uno revisa los documentos' }, { valor: false, titulo: 'Reunión normal' }], alCambiar: function () { extras(); } });
    var tipoFila = h('div.fila-campo', h('label.etiqueta-campo', 'Tipo de reunión'), patron);
    App.add(hj.cuerpo,
      h('div.fila-campo', h('label.etiqueta-campo', 'Título'), h('div.ayuda', 'Un nombre corto para la reunión.'), titulo),
      h('div.fila-campo', h('label.etiqueta-campo', 'Descripción'), h('div.ayuda', 'Opcional. Acá va el detalle: lo leen todos antes de opinar.'), tema),
      h('div.fila-campo', h('label.etiqueta-campo', 'Quiénes participan'), h('div.ayuda', 'Entre 2 y 10.'), grilla),
      h('div.aj-subtit', 'Cómo se habla'),
      tipoFila, liderFila, bandosFila,
      h('div.fila-campo', h('label.etiqueta-campo', 'Rondas'), h('div.ayuda', 'En cada ronda habla cada uno una vez. Después podés pedir otra.'), rondas),
      h('div.aj-subtit', 'Cuánto gasta'),
      h('div.fila-campo', h('label.etiqueta-campo', 'Modelo'), modeloReu),
      h('div.fila-campo', h('label.etiqueta-campo', 'Esfuerzo'), h('div.ayuda', 'Cuánto piensa cada uno antes de hablar. Más esfuerzo, más tokens.'), esfuerzoReu),
      h('div.fila-campo', h('label.etiqueta-campo', 'Memoria de la oficina'), h('div.ayuda', 'Si cada uno lee el contexto y las decisiones antes de hablar. «Solo si hace falta» gasta menos.'), memoriaReu),
      h('div.aj-subtit', 'Documentos de la biblioteca (opcional)'),
      h('div.fila-campo', h('div.ayuda', { style: { marginTop: 0 } }, 'Los participantes los leen antes de opinar.'), docs, docsAviso),
      h('div.fila-campo', h('label.etiqueta-campo', 'Panel de revisión'),
        h('div.ayuda', { style: { marginTop: 0, marginBottom: '6px' } }, 'Cada uno revisa los documentos adjuntos desde su rol: hallazgos, riesgos y cambios. Toma el lugar del tipo de reunión.'), revisar),
      h('div.fila-campo', h('label.etiqueta-campo', 'Dónde queda el acta'),
        h('div.ayuda', 'Al cerrar se guarda un resumen en Entregables › Reuniones.'),
        h('details.avanzado', h('summary', 'Opciones avanzadas'),
          h('div.ayuda', 'Ruta del archivo (dentro de archivos/). Si ya existe, se agrega -2, -3…'), salida)),
      err);
    api.get('/api/archivos').then(function (r) {
      var listos = (r.archivos || []).filter(function (f) { return f.estado === 'listo'; });
      if (!listos.length) { docs.appendChild(h('span.ayuda', 'No hay documentos listos.')); return; }
      listos.slice(0, 30).forEach(function (f) {
        var c = h('button.chip', { type: 'button', onclick: function () {
          var i = docsSel.indexOf(f.slug); if (i >= 0) docsSel.splice(i, 1); else docsSel.push(f.slug);
          c.classList.toggle('sel', docsSel.indexOf(f.slug) >= 0);
        } }, f.titulo);
        docs.appendChild(c);
      });
      if (listos.length > 30) { docsAviso.textContent = 'Se muestran los primeros 30 de ' + listos.length + ' documentos listos.'; docsAviso.classList.remove('oculto'); }
    }).catch(function () { docs.appendChild(h('span.ayuda', 'No se pudieron traer los documentos.')); });
    var ir = h('button.btn.primario', {
      onclick: function () {
        err.textContent = '';
        if (!titulo.value.trim()) { err.textContent = 'Escribí un título.'; return; }
        if (elegidos.length < 2) { err.textContent = 'Elegí al menos dos participantes.'; return; }
        var pat = revisar.valor() ? 'revision' : patron.valor();
        var cuerpo = { titulo: titulo.value.trim(), tema: tema.value.trim() || undefined, agentes: elegidos, rondas: +rondas.valor(), documentos: docsSel.length ? docsSel : undefined, patron: pat };
        if (pat === 'lider') {
          if (!lider) { err.textContent = 'Elegí quién lidera.'; return; }
          cuerpo.lider = lider;
        }
        if (pat === 'redblue') {
          var a = elegidos.filter(function (id) { return bando[id] === 'a'; }), b = elegidos.filter(function (id) { return bando[id] === 'b'; });
          if (!a.length || !b.length) { err.textContent = 'Poné al menos uno en cada bando.'; return; }
          cuerpo.bandos = { a: a, b: b };
        }
        if (pat === 'revision' && !docsSel.length) { err.textContent = 'El panel de revisión necesita al menos un documento.'; return; }
        if (editoSalida && salida.value.trim()) cuerpo.salida = salida.value.trim();
        if (modeloReu.valor()) cuerpo.modelo = modeloReu.valor();
        if (esfuerzoReu.valor()) cuerpo.esfuerzo = esfuerzoReu.valor();
        if (memoriaReu.valor() !== App.iaApp().memoria) cuerpo.memoria = memoriaReu.valor();
        ir.disabled = true;
        api.post('/api/reuniones', cuerpo)
          .then(function (r) { E.reunion = r; sincronizar(); panel(r.id); vigilar(r.id); })
          .catch(function (e) { err.textContent = e.message; ir.disabled = false; });
      }
    }, 'Empezar reunión');
    App.add(hj.pie, App.acciones([h('button.btn', { onclick: cancelar }, 'Cancelar')], ir));
    extras();
  }

  /* ---------------- seguimiento en vivo ---------------- */
  function vigilar(id) {
    vigilando = id;
    clearTimeout(reloj);
    function tic() {
      if (vigilando !== id) return;
      api.get('/api/reuniones/' + id).then(function (r) {
        if (vigilando !== id) return;
        var antes = E.reunion && E.reunion.id === id ? E.reunion : null;
        E.reunion = r;
        sincronizar();
        if (visto === id && (!antes || antes.turnos.length !== r.turnos.length || antes.hablando !== r.hablando || antes.estado !== r.estado)) pintarPanel(r);
        if (r.estado === 'en_curso') reloj = setTimeout(tic, 2000);
        else vigilando = null;
      }).catch(function () { reloj = setTimeout(tic, 5000); });
    }
    tic();
  }

  /* lleva el estado de la reunión a la maqueta, a la barra lateral y al aviso superior */
  function sincronizar() {
    var r = E.reunion, pill = App.dom && App.dom.avisoReu;
    if (activa(r)) {
      App.Oficina.reunion(r.agentes, r.estado === 'en_curso' ? r.hablando : null);
      App.dom.navReu.classList.remove('oculto');
      App.dom.navReu.textContent = r.estado === 'en_curso' ? 'En curso' : 'Esperando';
      if (pill) {
        App.add(App.vaciar(pill), h('span.punto', { style: { background: 'var(--ok)', borderRadius: '50%' } }),
          h('span', r.estado === 'en_curso' ? (r.hablando ? nombre(r.hablando) + ' está hablando' : 'Reunión en curso') : 'Reunión: esperándote'),
          visto === r.id && App.modoDerecho() === 'reunion' ? null : h('button.btn.chico', { onclick: function () { panel(r.id); } }, 'Ver'));
        pill.classList.remove('oculto');
      }
    } else {
      App.Oficina.finReunion();
      if (App.dom) { App.dom.navReu.classList.add('oculto'); if (pill) pill.classList.add('oculto'); }
    }
    App.marcarEstados();
  }

  function retomar() {
    vigilando = null; clearTimeout(reloj); E.reunion = null;
    api.get('/api/reuniones').then(function (r) {
      var x = (r.reuniones || []).filter(activa)[0];
      if (!x) { sincronizar(); return; }
      return api.get('/api/reuniones/' + x.id).then(function (d) { E.reunion = d; sincronizar(); if (d.estado === 'en_curso') vigilar(d.id); });
    }).catch(function () {});
  }

  /* ---------------- panel ---------------- */
  function panel(id) {
    visto = id;
    App.Agente.alCerrar();
    App.abrirDerecho('reunion');
    var r = E.reunion && E.reunion.id === id ? E.reunion : null;
    if (r) pintarPanel(r);
    else {
      App.vaciar(App.dom.derecho).appendChild(App.cargando('Abriendo la reunión…'));
      api.get('/api/reuniones/' + id).then(function (d) { if (activa(d)) { E.reunion = d; sincronizar(); if (d.estado === 'en_curso') vigilar(d.id); } pintarPanel(d); }).catch(App.fallo);
    }
    sincronizar();
  }

  function pintarPanel(r) {
    if (visto !== r.id || App.modoDerecho() !== 'reunion') return;
    if (r.estado === 'esperando' && App.Avisos) App.Avisos.vistoReunion(r.id);   // abierta = vista: se apaga «Reunión esperándote»
    var der = App.dom.derecho;
    var scrollAbajo = true;
    var viejo = der.querySelector('.der-cuerpo');
    if (viejo) scrollAbajo = viejo.scrollTop + viejo.clientHeight >= viejo.scrollHeight - 30;
    var cuerpo = h('div.der-cuerpo'), pie = h('div.der-pie');
    var est = r.estado === 'cerrada' ? 'Cerrada' : r.estado === 'en_curso' ? 'En curso' : 'Esperando: escribí algo, pedí otra ronda o cerrá';
    App.add(App.vaciar(der),
      App.cabPanel({ icono: 'reunion', titulo: r.titulo || r.tema, sub: est + ' · ' + patronDe(r.patron).nombre + ' · ' + r.agentes.map(nombre).join(', ') }),
      cuerpo, pie);
    if (r.tema && r.tema.trim() && r.tema.trim() !== (r.titulo || '')) cuerpo.appendChild(h('div.reunion-desc', r.tema));
    var t = h('div.turnos'), ronda = 0;
    r.turnos.forEach(function (x) {
      if (x.ronda !== ronda && x.agente !== 'usuario') { ronda = x.ronda; t.appendChild(h('div.ronda-sep', 'Ronda ' + ronda)); }
      var a = App.agente(x.agente), yo = x.agente === 'usuario';
      t.appendChild(h('div.turno' + (yo ? '.usuario' : ''),
        yo ? App.Yo.retrato('retrato', 64)
          : a ? App.retratoImg(a, 'retrato', 64) : h('div.retrato'),
        h('div.turno-cuerpo', h('div.turno-quien', yo ? (App.Yo.nombre() || E.oficina.duenio || 'Vos') : nombre(x.agente), h('small', a ? a.rol : '')),
          yo ? h('div.turno-txt', x.texto) : App.htmlSeguro(h('div.turno-txt' + (x.error ? '.error-txt' : '')), App.markdown(x.texto)))));
    });
    if (r.estado === 'en_curso' && r.hablando) {
      var ah = App.agente(r.hablando);
      t.appendChild(h('div.turno', ah ? App.retratoImg(ah, 'retrato', 64) : h('div.retrato'),
        h('div.turno-cuerpo', h('div.turno-quien', nombre(r.hablando)), h('div.escribiendo', h('span.puntos', h('i'), h('i'), h('i')), 'pensando su opinión…'))));
    }
    if (!r.turnos.length && r.estado !== 'en_curso') t.appendChild(h('div.vacio', 'Sin turnos.'));
    cuerpo.appendChild(t);
    if (r.estado !== 'cerrada' && (r.resumenParcial || resumiendo === r.id)) cuerpo.appendChild(resumenParcial(r));
    if (r.sintesis) cuerpo.appendChild(sintesis(r));
    if (r.errorSintesis) cuerpo.appendChild(h('div.sintesis', h('div.error-txt', 'No se pudo armar el acta: ' + r.errorSintesis)));
    if (r.error) cuerpo.appendChild(h('div.sintesis', h('div.error-txt', r.error)));

    if (r.estado === 'cerrada') {
      App.add(pie, h('div.acciones',
        r.salidaRuta && App.nativo.hay ? h('button.btn', { onclick: function () { App.nativo.abrir(r.salidaRuta); } }, App.icono('abrir'), 'Abrir archivo de salida') : null,
        r.acta && (App.nativo.hay || App.esMarkdown(r.acta)) ? h('button.btn', { onclick: function () { if (App.esMarkdown(r.acta)) App.abrirMarkdownOficina(r.acta); else App.nativo.abrir(r.actaRuta); } }, App.icono('abrir'), 'Ver acta') : null,
        h('button.btn.primario', { onclick: function () { nueva(); } }, 'Llamar a otra reunión')));
    } else {
      /* chat: lo que escribís lo toman los turnos que siguen; si no queda ninguna ronda, arranca (o se suma) una más */
      /* se repinta todo con cada turno nuevo: si estabas escribiendo, el foco y el cursor vuelven en el acto
         (sin setTimeout: en ese hueco las teclas caían en el body y disparaban atajos globales) */
      var previo = document.activeElement && document.activeElement.classList.contains('reunion-txt') ? document.activeElement : null;
      var sel = previo ? { ini: previo.selectionStart, fin: previo.selectionEnd, dir: previo.selectionDirection, top: previo.scrollTop } : null;
      var txt = h('textarea.campo.reunion-txt', { rows: 1, maxlength: 5000,
        placeholder: r.estado === 'en_curso' ? 'Escribile a la reunión: lo van a tener en cuenta en lo que sigue…' : 'Escribile a la reunión: responden en una ronda más…' });
      txt.value = borrador[r.id] || '';
      var mandar = h('button.btn.primario.icono', { title: 'Enviar (Enter)', disabled: cerrando, onclick: enviar }, App.icono('enviar'));
      function alto() { txt.style.height = 'auto'; txt.style.height = Math.min(160, txt.scrollHeight + 2) + 'px'; }
      txt.addEventListener('input', function () { borrador[r.id] = txt.value; alto(); });
      txt.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(); } });
      function enviar() {
        var v = txt.value.trim(); if (!v || cerrando || mandar.disabled) { txt.focus(); return; }
        mandar.disabled = true;
        api.post('/api/reuniones/' + r.id + '/intervencion', { texto: v }).then(function (d) {
          borrador[r.id] = ''; E.reunion = d; sincronizar(); pintarPanel(d);
          if (d.estado === 'en_curso' && vigilando !== d.id) vigilar(d.id);
          var nt = App.dom.derecho.querySelector('.reunion-txt'); if (nt) nt.focus();
        }).catch(function (e) { mandar.disabled = false; App.fallo(e); });
      }
      var ocupado = r.estado === 'en_curso' || cerrando;
      App.add(pie, h('div.redactar', txt, mandar), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px', alignItems: 'center' } },
        h('span.ayuda.solo-compu', { style: { margin: 0 } }, 'Enter para enviar · Mayús+Enter para otra línea'),
        h('span', { style: { flex: 1 } }),
        h('button.btn', { disabled: cerrando || resumiendo === r.id || !r.turnos.some(function (x) { return x.agente !== 'usuario' && !x.error; }),
          title: 'Un resumen de lo dicho hasta ahora, sin cerrar la reunión', onclick: function () { resumir(r); } },
          resumiendo === r.id ? [h('span.giro'), 'Resumiendo…'] : 'Resumen hasta acá'),
        h('button.btn', { disabled: ocupado, onclick: function () {
          api.post('/api/reuniones/' + r.id + '/ronda').then(function (d) { E.reunion = d; sincronizar(); pintarPanel(d); vigilar(d.id); }).catch(App.fallo);
        } }, 'Otra ronda'),
        h('button.btn.primario', { disabled: ocupado, onclick: function () { cerrar(r); } }, cerrando ? [h('span.giro'), 'Armando el acta…'] : 'Cerrar y resumir')));
      if (txt.value) alto();
      if (sel) {
        txt.focus({ preventScroll: true });
        var n = txt.value.length;
        txt.setSelectionRange(Math.min(sel.ini, n), Math.min(sel.fin, n), sel.dir || 'none');
        txt.scrollTop = sel.top;
      }
    }
    if (scrollAbajo) cuerpo.scrollTop = cuerpo.scrollHeight;
  }

  /* resumen de lo dicho hasta ahora, sin cerrar: para pensar qué contestar */
  function resumenParcial(r) {
    var s = r.resumenParcial;
    if (!s) return h('div.sintesis', App.cargando('Armando un resumen de lo dicho hasta ahora…'));
    var nuevos = r.turnos.length - (s.turnos || 0);
    return h('div.sintesis',
      h('h4', 'Resumen hasta acá'),
      h('div.ayuda', { style: { marginTop: 0 } }, App.fecha(s.ts) + (nuevos > 0 ? ' · desde entonces hubo ' + (nuevos === 1 ? '1 intervención más' : nuevos + ' intervenciones más') : '') + ' · la reunión sigue abierta'),
      h('p', s.resumen || '—'),
      s.abiertas && s.abiertas.length ? [h('h4', 'Esperan tu respuesta'), h('div.ayuda', { style: { marginTop: 0 } }, 'Tocá una para responderla.'),
        h('div.chips-preguntas', s.abiertas.map(function (d) { return h('button.chip.pregunta', { type: 'button', title: 'Responder esto', onclick: function () { responderA(r, d); } }, d); }))] : null,
      s.decisiones && s.decisiones.length ? [h('h4', 'Lo que ya parece acordado'), h('ul', s.decisiones.map(function (d) { return h('li', d); }))] : null,
      s.pendientes && s.pendientes.length ? [h('h4', 'Próximos pasos propuestos'), h('ul', s.pendientes.map(function (p) { return h('li', p.quien ? [h('b', p.quien + ': '), p.que] : p.que); }))] : null);
  }

  /* una pregunta abierta: carga el texto en el campo de intervención para contestarla */
  function responderA(r, pregunta) {
    var txt = App.dom.derecho.querySelector('.reunion-txt');
    if (!txt) return;
    var v = 'Sobre «' + pregunta + '»: ';
    txt.value = v; borrador[r.id] = v;
    txt.style.height = 'auto'; txt.style.height = Math.min(160, txt.scrollHeight + 2) + 'px';
    txt.focus();
    txt.setSelectionRange(v.length, v.length);
  }

  function resumir(r) {
    resumiendo = r.id; pintarPanel(E.reunion && E.reunion.id === r.id ? E.reunion : r);
    api.post('/api/reuniones/' + r.id + '/resumen').then(function (d) {
      resumiendo = null;
      if (E.reunion && E.reunion.id === d.id) E.reunion = d;
      pintarPanel(d);
    }).catch(function (e) { resumiendo = null; App.fallo(e); pintarPanel(E.reunion && E.reunion.id === r.id ? E.reunion : r); });
  }

  function sintesis(r) {
    var s = r.sintesis || {};
    return h('div.sintesis',
      h('h4', 'Resumen'), h('p', s.resumen || '—'),
      s.decisiones && s.decisiones.length ? [h('h4', 'Decisiones'), h('ul', s.decisiones.map(function (d) { return h('li', d); }))] : null,
      s.pendientes && s.pendientes.length ? pendientes(r, s) : null,
      r.acta ? h('div.ayuda', { style: { marginTop: '10px' } }, 'Las decisiones se sumaron a la memoria de la oficina.') : null);
  }

  /* ---------------- pendientes que se ejecutan ---------------- */
  /* agrupados por quién tiene que actuar: vos, los agentes, los que te necesitan, lo que está en marcha y lo hecho */
  function pendientes(r, s) {
    var ests = r.pendientesEstado || [];
    var G = { vos: [], agentes: [], necesitan: [], marcha: [], hechos: [], otros: [] };
    s.pendientes.forEach(function (p, i) {
      var est = ests[i];
      if (!est) { G.otros.push(filaPendiente(r, s, p, i, null)); return; }
      var enc = est.encargo, esp = est.espera;
      var haciendo = enc && (enc.estado === 'corriendo' || enc.estado === 'esperando_permiso');
      var g = est.hecho || (enc && enc.entrega) ? 'hechos'
        : esp || haciendo ? 'marcha'
        : est.encargable ? 'agentes'
        : !est.agente ? 'vos' : 'necesitan';
      G[g].push(filaPendiente(r, s, p, i, est));
    });
    var porEncargar = ests.filter(function (e) { return e.encargable && !e.encargo && !e.espera; }).length;
    var hayDeps = s.pendientes.some(function (p) { return p.depende_de && p.depende_de.length; });
    var secs = [];
    if (G.otros.length) secs.push(App.seccion('Pendientes', G.otros, { cuenta: G.otros.length }));
    if (G.vos.length) secs.push(App.seccion('Te toca a vos', G.vos, { cuenta: G.vos.length }));
    if (G.agentes.length) {
      var todo = porEncargar > 1 ? h('button.btn.chico', { onclick: function (ev) {
        ev.currentTarget.disabled = true;
        api.post('/api/reuniones/' + r.id + '/pendientes/encargar-todos').then(function (d) {
          r.pendientesEstado = d.pendientesEstado; pintarPanel(r); vigilarPendientes(r.id);
          App.aviso('Encargado: los que dependen de otros arrancan cuando esos entreguen.');
        }).catch(function (e) { App.fallo(e); pintarPanel(r); });
      } }, 'Encargar todo') : null;
      secs.push(App.seccion('Lo pueden hacer los agentes', G.agentes, { cuenta: G.agentes.length, accion: todo }));
    }
    if (G.necesitan.length) secs.push(App.seccion('Te necesitan para seguir', G.necesitan, { cuenta: G.necesitan.length, ayuda: 'No lo pueden hacer solos: falta tu parte.' }));
    if (G.marcha.length) secs.push(App.seccion('En marcha o esperando', G.marcha, { cuenta: G.marcha.length }));
    if (G.hechos.length) secs.push(App.seccion('Hechos', h('details.pend-hechos', h('summary', 'Mostrar los ' + G.hechos.length), G.hechos), { cuenta: G.hechos.length }));
    if (hayDeps) {
      secs.push(App.acciones(null, h('button.btn.chico.fantasma', { title: 'Arma un flujo con estos pasos para repetirlo otra vez', onclick: function () {
        api.post('/api/reuniones/' + r.id + '/flujo').then(function (d) {
          if (App.Flujos && App.Flujos.editor) App.Flujos.editor(null, d.borrador);
        }).catch(App.fallo);
      } }, App.icono('flujo'), 'Pasar a flujo')));
    }
    return h('div.pendientes', secs);
  }

  function nombresDe(ids) {
    var ns = (ids || []).map(function (id) { return id === 'persona' ? 'vos' : App.humano.quien(id); });
    return ns.length < 2 ? ns.join('') : ns.slice(0, -1).join(', ') + (ns[ns.length - 1] === 'vos' ? ' y a vos' : ' y ' + ns[ns.length - 1]);
  }

  /* «Ya lo hice»: la nota es opcional; deja una entrega tuya que libera a quien esperaba este pendiente */
  function yaLoHice(r, i, p) {
    var hj = App.hoja({ titulo: 'Ya lo hice', ancho: 480 });
    var txt = h('textarea.campo', { rows: 4, maxlength: 4000, autofocus: true, placeholder: 'Opcional: contá qué hiciste o dónde quedó, para quien lo estaba esperando.' });
    var err = h('div.error-txt');
    App.add(hj.cuerpo, h('div.fila-campo', h('label.etiqueta-campo', '«' + p.que + '»'), txt), err);
    var ok = h('button.btn.primario', { onclick: function () {
      ok.disabled = true; err.textContent = '';
      api.post('/api/reuniones/' + r.id + '/pendientes/' + i + '/hecho', { nota: txt.value.trim() || undefined }).then(function (d) {
        hj.cerrar(); r.pendientesEstado = d.pendientesEstado; pintarPanel(r); vigilarPendientes(r.id);
        App.aviso('Anotado: quien lo esperaba ya puede seguir.');
      }).catch(function (e) { err.textContent = e.message; ok.disabled = false; });
    } }, 'Ya lo hice');
    App.add(hj.pie, h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), ok);
  }

  /* una fila por pendiente: el qué como título, de quién depende y en qué quedó como bajada, UN botón principal y el resto en «⋯» */
  function filaPendiente(r, s, p, i, est) {
    var ag = est && est.agente && App.agente(est.agente);
    var marca = ag || (est && est.agente ? h('div.retrato') : App.Yo.retrato('retrato', 64));
    if (!est) return App.filaDecision({ marca: marca, titulo: p.que, sub: p.quien ? App.humano.quien(p.quien) : null });
    var sub = [ag ? ag.nombre : est.agente ? App.humano.quien(est.agente) : 'Vos'];
    if (est.dependeDe && est.dependeDe.length) {
      sub.push('Después de ' + est.dependeDe.map(function (d) { var x = s.pendientes[d]; return '«' + (x ? x.que : 'otro pendiente') + '»'; }).join(' y '));
    }
    (est.tareas || []).forEach(function (t) { sub.push('Tarea: ' + t.nombre); });
    var estado = null, principal = null, mas = [];
    var enc = est.encargo, esp = est.espera;
    if (esp) {
      var texto = esp.estado === 'relanzada' ? 'Arrancando…' : esp.estado === 'lista' ? 'Ya llegó todo, arranca enseguida' : 'Esperando a ' + nombresDe(esp.esperaA);
      estado = h('span.insignia.aviso', esp.estado === 'esperando' ? App.icono('reloj') : h('span.giro'), ' ' + texto);
      vigilarPendientes(r.id);
      if (esp.estado !== 'relanzada') {
        principal = h('button.btn.chico', { title: 'Lo hace ahora, con lo que haya', onclick: function (ev) {
          ev.currentTarget.disabled = true;
          api.post('/api/reuniones/' + r.id + '/pendientes/' + i + '/encargar', { forzar: true }).then(function (d) {
            r.pendientesEstado = d.pendientesEstado; pintarPanel(r); vigilarPendientes(r.id);
            App.aviso('Arrancó sin esperar.');
          }).catch(function (e) { App.fallo(e); pintarPanel(r); });
        } }, 'Arrancar igual');
        mas.push({ texto: 'Cancelar espera', icono: 'cerrar', accion: function () {
          Promise.all((esp.ids || []).map(function (id) { return api.post('/api/esperas/' + id + '/cancelar').catch(function () {}); })).then(function () {
            App.aviso('Espera cancelada.'); refrescar(r.id);
          });
        } });
      }
    }
    if (est.hecho) {
      estado = h('span.insignia.ok', 'Hecho por vos');
    } else if (enc && enc.estado === 'corriendo') {
      estado = h('span.insignia.aviso', h('span.giro'), ' Trabajando en esto…');
      vigilarPendientes(r.id);
    } else if (enc && enc.estado === 'esperando_permiso') {
      estado = h('span.insignia.aviso', 'Esperando tu permiso');
      vigilarPendientes(r.id);
    } else if (enc && enc.entrega) {
      var revisada = enc.entregaEstado === 'revisada';
      estado = h('span.insignia' + (revisada ? '.ok' : '.aviso'), revisada ? 'Entregado y revisado' : 'Entregado · sin revisar');
      principal = h('button.btn.chico', { onclick: function () { if (App.Entregables) App.Entregables.abrir(enc.entrega); } }, 'Ver entrega');
    } else if (enc && enc.estado === 'error') {
      estado = h('span.insignia.error', { title: enc.error || '' }, 'Falló');
    }
    var haciendo = enc && (enc.estado === 'corriendo' || enc.estado === 'esperando_permiso');
    if (est.encargable && !haciendo && !esp) {
      var encargar = function (btn) {
        if (btn) btn.disabled = true;
        api.post('/api/reuniones/' + r.id + '/pendientes/' + i + '/encargar').then(function (d) {
          r.pendientesEstado = d.pendientesEstado; pintarPanel(r); vigilarPendientes(r.id);
          App.aviso(ag ? ag.nombre + ' se puso a trabajar en eso.' : 'Encargado.');
        }).catch(function (e) { App.fallo(e); pintarPanel(r); });
      };
      if (principal) mas.push({ texto: 'Hacerlo de nuevo', icono: 'enviar', accion: function () { encargar(null); } });
      else principal = h('button.btn.chico' + (enc ? '' : '.primario'), { onclick: function (ev) { encargar(ev.currentTarget); } }, enc ? 'Hacerlo de nuevo' : 'Hacelo ahora');
      mas.push({ texto: 'Convertir en tarea', icono: 'parte', accion: function () {
        if (!App.Agente || !App.Agente.nuevaTarea) return;
        App.Agente.nuevaTarea(est.agente, { nombre: p.que.length > 80 ? p.que.slice(0, 79) + '…' : p.que,
          consigna: 'Pendiente de la reunión «' + (r.titulo || r.tema) + '»' + (r.acta ? ' (acta: ' + r.acta + ')' : '') + ': ' + p.que,
          origen: { reunion: r.id, pendiente: i }, unica: true }, function () { refrescar(r.id); });
      } });
    } else if (!est.encargable && !est.hecho && !enc) {
      principal = h('button.btn.chico.primario', { title: 'Marcalo como hecho: lo que dependa de esto puede seguir', onclick: function () { yaLoHice(r, i, p); } }, 'Ya lo hice');
      /* nació a nombre de alguien que no es agente (o sin agente): dejá dárselo a uno de los tuyos */
      var ags = (E.oficina.agentes || []);
      if (ags.length && App.Agente && App.Agente.nuevaTarea) {
        mas.push({ titulo: 'Dárselo a un agente' });
        ags.forEach(function (a) {
          mas.push({ retrato: a, texto: a.nombre, nota: a.rol || '', accion: function () {
            App.Agente.nuevaTarea(a.id, {
              nombre: p.que.length > 80 ? p.que.slice(0, 79) + '…' : p.que,
              consigna: 'Pendiente de la reunión «' + (r.titulo || r.tema) + '»' + (r.acta ? ' (acta: ' + r.acta + ')' : '') + ': ' + p.que,
              origen: { reunion: r.id, pendiente: i }, unica: true
            }, function () { refrescar(r.id); });
          } });
        });
      }
    }
    return App.filaDecision({ marca: marca, titulo: p.que, sub: sub.join(' · '), estado: estado, principal: principal, mas: mas });
  }

  function refrescar(id) {
    return api.get('/api/reuniones/' + id).then(function (d) { if (visto === id) pintarPanel(d); return d; });
  }

  /* mientras haya un encargo corriendo y el panel muestre esta reunión, se vuelve a leer cada 3 s */
  var relojPend = null;
  function vigilarPendientes(id) {
    clearTimeout(relojPend);
    relojPend = setTimeout(function () {
      if (visto !== id) return;
      refrescar(id).then(function (d) {
        if ((d.pendientesEstado || []).some(function (e) { return (e.encargo && (e.encargo.estado === 'corriendo' || e.encargo.estado === 'esperando_permiso')) || e.espera; })) vigilarPendientes(id);
      }).catch(function () { /* se reintenta al volver a abrir */ });
    }, 3000);
  }

  function cerrar(r) {
    cerrando = true; pintarPanel(r);
    api.post('/api/reuniones/' + r.id + '/cerrar').then(function (d) {
      cerrando = false; E.reunion = d; vigilando = null;
      sincronizar(); pintarPanel(d);
      App.aviso('Reunión cerrada. El acta quedó guardada.');
    }).catch(function (e) { cerrando = false; App.fallo(e); pintarPanel(E.reunion || r); });
  }

  App.Reunion = {
    abrir: abrir, nueva: nueva, retomar: retomar, ver: panel,
    abierta: function () { return App.modoDerecho && App.modoDerecho() === 'reunion' ? visto : null; },
    alCerrarPanel: function () { visto = null; sincronizar(); }
  };
})();
