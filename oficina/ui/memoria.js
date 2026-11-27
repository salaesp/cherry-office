/* Memoria de la oficina, dentro de la Biblioteca (docs/plan-memoria.md): el bibliotecario (qué está haciendo y cada cuánto
   ordena), su propuesta de la primera vez, los choques que decide la persona, los temas y «Preguntale». */
(function () {
  'use strict';
  var h = App.h, api = App.api;
  var TOPE_POR_DEFECTO = 6000, TOPE_OFICINA = 1500, TOPE_NOTAS = 1000;
  var FRECUENCIAS = [
    { valor: 'diaria', titulo: 'Todos los días' },
    { valor: 'semanal', titulo: 'Una vez por semana' },
    { valor: 'manual', titulo: 'Solo cuando lo pida' }];
  var BIBLIOTECARIO = { id: 'bibliotecario', avatar: { semilla: 'bibliotecario', pxPelo: 'rodete', colorPelo: '#9a9a9a', pxArriba: 'traje', colorTorso: '#5b4a3a' } };
  var reloj = null;
  var recientes = [];                 // las últimas 5 preguntas: solo en la pantalla, no en el backend

  function nf(n) { return Number(n || 0).toLocaleString('es-AR'); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function hace(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'hace un momento';
    if (m < 60) return 'hace ' + plural(m, 'minuto', 'minutos');
    if (m < 60 * 24) return 'hace ' + plural(Math.round(m / 60), 'hora', 'horas');
    return 'hace ' + plural(Math.round(m / 1440), 'día', 'días');
  }
  function diaCorto(s) { var p = String(s || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : ''; }
  /* lo que la persona tiene para hacer: choques por decidir y la propuesta sin revisar (insignia del menú) */
  function contar(st) { return st ? (st.choques || 0) + (st.propuesta ? 1 : 0) : 0; }

  function abrirArchivo(ruta) {
    if (App.ChatRico && ruta) App.ChatRico.abrirArchivo(String(ruta).split('#')[0]);
  }

  /* ---- cabecera del bibliotecario ---- */
  function frase(st) {
    var u = st.ultima;
    if (st.corriendo) return App.cargando('Ordenando la memoria…');
    if (st.propuesta) return 'Te preparó una propuesta para revisar';
    if (u && u.estado === 'error') return 'Algo salió mal la última vez: ' + (u.error || 'no pude ordenar la memoria.');
    if (st.choques) return 'Hay ' + plural(st.choques, 'cosa', 'cosas') + ' para que decidas';
    return 'Al día';
  }
  function ultimaVez(st) {
    var u = st.ultima;
    if (!u) return 'Todavía no ordenó nada.';
    if (u.estado === 'error') return 'Última vez: ' + hace(u.fin) + ' · no pudo.';
    var n = u.resultado && u.resultado.temas ? u.resultado.temas.length : 0;
    return 'Última vez: ' + hace(u.fin) + ' · ' + (n ? 'ordenó ' + plural(n, 'tema', 'temas') : 'no había nada para ordenar');
  }
  function barra(st) {
    var t = st.tokens || {}, tope = st.topeTokens > 0 ? st.topeTokens : TOPE_POR_DEFECTO;
    var pasa = (t.total || 0) > tope;
    var detalle = 'oficina.md ' + nf(t.oficina) + ' · índice ' + nf(t.indice) + ' · decisiones ' + nf(t.decisiones) + ' · notas más largas ' + nf(t.notasMax);
    var avisos = [];
    if ((t.oficina || 0) > TOPE_OFICINA) avisos.push('oficina.md pasa su tope (' + nf(TOPE_OFICINA) + ' tokens): conviene achicarla a mano.');
    if ((t.notasMax || 0) > TOPE_NOTAS) avisos.push('Las notas de algún agente pasan su tope (' + nf(TOPE_NOTAS) + ' tokens).');
    return h('div.memoria-uso',
      h('div.memoria-uso-txt', { title: detalle }, 'Lo que se lee siempre: ≈ ' + nf(t.total) + ' de ' + nf(tope) + ' tokens'),
      h('div.memoria-barra' + (pasa ? '.pasa' : ''), { role: 'progressbar', 'aria-valuenow': String(t.total || 0), 'aria-valuemax': String(tope) },
        h('i', { style: { width: Math.min(100, Math.round(100 * (t.total || 0) / tope)) + '%' } })),
      avisos.map(function (a) { return h('div.ayuda', a); }));
  }

  /* ---- la pantalla ---- */
  function pintar(cont, op) {
    op = op || {};
    clearTimeout(reloj);
    var raiz = h('div.memoria');
    var zonaCab = h('div'), zonaProp = h('div'), zonaChoques = h('div'), zonaTemas = h('div');
    var ver = null;           // slug del tema abierto en el panel de detalle
    var recargando = false;
    App.add(App.vaciar(cont), App.add(raiz, zonaCab, zonaProp, zonaChoques, zonaTemas, preguntale()));
    zonaCab.appendChild(App.cargando('Trayendo la memoria…'));

    function vivo() { return document.body.contains(raiz); }
    function avisarCambio() { if (op.alCambiar) op.alCambiar(); }

    function refrescar() {
      if (recargando || !vivo()) return;
      recargando = true;
      api.get('/api/memoria').then(function (st) {
        var pide = [Promise.resolve(st), st.propuesta ? api.get('/api/memoria/propuesta').catch(function () { return null; }) : Promise.resolve(null),
          api.get('/api/memoria/choques'), api.get('/api/memoria/temas')];
        return Promise.all(pide);
      }).then(function (rs) {
        recargando = false;
        if (!vivo()) return;
        var st = rs[0];
        if (App.Oficina && App.Oficina.bibliotecario) App.Oficina.bibliotecario(st);   // el de la oficina pixel se entera al instante
        pintarCab(st);
        pintarPropuesta(rs[1] && rs[1].propuesta);
        pintarChoques(rs[2].choques || []);
        pintarTemas(rs[3].temas || []);
        avisarCambio();
        clearTimeout(reloj);
        if (st.corriendo) reloj = setTimeout(refrescar, 3000);
      }).catch(function (e) {
        recargando = false;
        if (vivo()) App.add(App.vaciar(zonaCab), h('div.vacio', e.message));
      });
    }

    /* cabecera: quién es, qué está haciendo, cuánto ocupa la memoria y los controles */
    function pintarCab(st) {
      var cons = h('button.btn.primario', { disabled: st.corriendo || st.propuesta || st.version < 2, onclick: function () {
        api.post('/api/memoria/consolidar').then(function () { App.aviso('El bibliotecario se puso a ordenar la memoria.'); refrescar(); }).catch(App.fallo);
      } }, App.icono('chispa'), 'Consolidar ahora');
      var cada = App.elegir({ opciones: FRECUENCIAS, valor: st.consolidar, etiqueta: 'Cada cuánto ordena', alCambiar: function (v) {
        api.put('/api/memoria/config', { consolidar: v }).then(function () { App.aviso('Listo: va a ordenar ' + FRECUENCIAS.filter(function (f) { return f.valor === v; })[0].titulo.toLowerCase() + '.'); }).catch(function (e) { App.fallo(e); refrescar(); });
      } });
      var porTope = h('input', { type: 'checkbox', checked: st.topeTokens > 0, onchange: function () {
        api.put('/api/memoria/config', { topeTokens: this.checked ? (st.topeTokens > 0 ? st.topeTokens : TOPE_POR_DEFECTO) : 0 }).then(refrescar).catch(function (e) { App.fallo(e); refrescar(); });
      } });
      App.add(App.vaciar(zonaCab), h('div.memoria-cabecera',
        App.retratoImg(BIBLIOTECARIO, 'retrato', 96),
        h('div.memoria-cab-txt',
          h('h3', 'El bibliotecario'),
          h('div.memoria-estado' + (st.ultima && st.ultima.estado === 'error' && !st.corriendo && !st.propuesta ? '.error' : ''), frase(st)),
          h('div.ayuda', ultimaVez(st)),
          barra(st))),
        h('div.memoria-controles',
          cons,
          h('div.memoria-cada', h('div.ayuda', 'Cada cuánto'), cada),
          h('label.memoria-check', porTope, h('span', 'Ordenar también cuando la memoria pase el tope'))));
    }

    /* propuesta de la primera vez: casillas para elegir qué se aplica */
    function pintarPropuesta(p) {
      App.vaciar(zonaProp);
      if (!p) return;
      var cT = {}, cN = {}, cA = {}, cO = null;
      function fila(casilla, cuerpo) { return h('div.memoria-fila', h('label.memoria-casilla', casilla), h('div.memoria-fila-cuerpo', cuerpo)); }
      function marcada() { return h('input', { type: 'checkbox', checked: true }); }
      var secciones = [];
      if (p.temas.length) {
        secciones.push(h('h4.memoria-sec-tit', 'Temas (' + p.temas.length + ')'), p.temas.map(function (t) {
          var c = cT[t.slug] = marcada();
          var cuerpo = h('div.texto-largo', { style: { display: 'none' } }, t.cuerpo);
          var vermas = h('button.btn.chico.fantasma', { type: 'button', onclick: function () {
            var abierto = cuerpo.style.display !== 'none';
            cuerpo.style.display = abierto ? 'none' : '';
            vermas.textContent = abierto ? 'ver' : 'ocultar';
          } }, 'ver');
          return fila(c, [h('div', h('b', t.titulo), ' ', h('span.insignia', t.nuevo ? 'nuevo' : 'se actualiza'), ' ', vermas),
            t.resumen ? h('div.ayuda', t.resumen) : null,
            t.fusionar && t.fusionar.length ? h('div.ayuda', 'Absorbe: ' + t.fusionar.join(', ')) : null, cuerpo]);
        }));
      }
      if (p.noVigentes.length) {
        secciones.push(h('h4.memoria-sec-tit', 'Decisiones que dejarían de estar vigentes (' + p.noVigentes.length + ')'), p.noVigentes.map(function (d) {
          var c = cN[d.n] = marcada();
          return fila(c, [h('div', d.linea), d.motivo ? h('div.ayuda', d.motivo) : null, h('div.ayuda', 'Sigue en el histórico del mes.')]);
        }));
      }
      if (p.agentes.length) {
        secciones.push(h('h4.memoria-sec-tit', 'Notas de cada agente (' + p.agentes.length + ')'), p.agentes.map(function (a) {
          var c = cA[a.id] = marcada();
          return fila(c, [h('b', a.nombre), h('div.difs', h('div', h('div.ayuda', 'Hoy'), a.antes), h('div', h('div.ayuda', 'Queda'), a.estado)),
            a.historial && a.historial.length ? h('div.ayuda', 'Lo demás pasa al historial (' + plural(a.historial.length, 'línea', 'líneas') + '): se puede buscar.') : h('div.ayuda', 'Lo que no quede se guarda en el historial.')]);
        }));
      }
      if (p.oficina) {
        cO = marcada();
        secciones.push(h('h4.memoria-sec-tit', 'Memoria común (oficina.md)'),
          fila(cO, [h('div.difs', h('div', h('div.ayuda', 'Hoy'), p.oficina.antes), h('div', h('div.ayuda', 'Queda'), p.oficina.texto)),
            p.oficina.aTemas && p.oficina.aTemas.length ? h('div.ayuda', 'Lo que saca pasa a los temas: ' + p.oficina.aTemas.join(', ') + '. La versión de hoy queda en el respaldo.') : null]));
      }
      if (p.choques && p.choques.length) secciones.push(h('div.ayuda', 'Además hay ' + plural(p.choques.length, 'cosa', 'cosas') + ' que no pudo decidir: te las muestra al aplicar, para que elijas vos.'));
      if (!secciones.length) secciones.push(h('p.ayuda', 'No encontró nada para cambiar.'));
      function lista(o) { return Object.keys(o).filter(function (k) { return o[k].checked; }); }
      zonaProp.appendChild(h('div.propuesta',
        h('b', 'Primera vez: el bibliotecario propone cómo ordenar la memoria. Nada cambia sin tu OK.'),
        p.resumen ? h('p.ayuda', p.resumen) : null,
        secciones,
        App.acciones(null, [
          h('button.btn.chico.fantasma', { onclick: function () {
            api.post('/api/memoria/propuesta', { aplicar: false }).then(function () { App.aviso('Propuesta descartada. No se cambió nada.'); refrescar(); }).catch(App.fallo);
          } }, 'Descartar'),
          h('button.btn.chico.primario', { onclick: function () {
            api.post('/api/memoria/propuesta', {
              aplicar: true, temas: lista(cT), noVigentes: lista(cN).map(Number), agentes: lista(cA), oficina: cO ? cO.checked : false,
            }).then(function (r) {
              var res = r.consolidacion.resultado || {}, salt = (res.salteados || []).length;
              App.aviso('Listo: se aplicó lo marcado.' + (salt ? ' ' + plural(salt, 'cosa se salteó', 'cosas se saltearon') + ' porque cambiaron mientras tanto.' : ''));
              refrescar();
            }).catch(App.fallo);
          } }, 'Aplicar lo marcado')])));
    }

    /* choques: dos cosas que se contradicen y no está claro cuál vale */
    function pintarChoques(cs) {
      App.vaciar(zonaChoques);
      if (!cs.length) return;
      zonaChoques.appendChild(h('h4.memoria-sec-tit', 'Para decidir (' + cs.length + ')'));
      cs.forEach(function (c) {
        var comoDecision = h('input', { type: 'checkbox' });
        var campo = h('textarea.campo', { rows: 2, placeholder: 'Escribí cómo tiene que quedar', maxlength: 600 });
        var cajaTexto = h('div', { style: { display: 'none', marginTop: '8px' } }, campo,
          App.acciones(null, [h('button.btn.chico.primario', { onclick: function () {
            if (!campo.value.trim()) { App.aviso('Escribí cómo tiene que quedar.', true); return; }
            resolver(c, { eleccion: 'texto', texto: campo.value.trim() });
          } }, 'Guardar')]));
        function resolver(ch, cuerpo) {
          if (ch.tema !== '') cuerpo.comoDecision = comoDecision.checked;
          api.post('/api/memoria/choques/' + encodeURIComponent(ch.id), cuerpo).then(function () { App.aviso('Listo, queda registrado.'); refrescar(); }).catch(App.fallo);
        }
        zonaChoques.appendChild(h('div.propuesta',
          h('b', c.temaTitulo),
          h('div.difs', h('div', h('div.ayuda', 'Hoy dice'), c.actual), h('div', h('div.ayuda', 'Nuevo'), c.nuevo)),
          c.fuentes && c.fuentes.length ? h('div.ayuda', 'Sale de: ' + c.fuentes.join(', ')) : null,
          App.acciones(null, [
            h('button.btn.chico', { onclick: function () { resolver(c, { eleccion: 'actual' }); } }, 'Queda lo de hoy'),
            h('button.btn.chico', { onclick: function () { resolver(c, { eleccion: 'nuevo' }); } }, 'Vale lo nuevo'),
            h('button.btn.chico', { onclick: function () { cajaTexto.style.display = cajaTexto.style.display === 'none' ? '' : 'none'; } }, 'Escribirlo yo')]),
          c.tema !== '' ? h('label.memoria-check', comoDecision, h('span', 'Registrarlo como decisión')) : null,
          cajaTexto));
      });
    }

    /* temas: lista y lectura en el panel de detalle */
    function pintarTemas(ts) {
      App.vaciar(zonaTemas);
      zonaTemas.appendChild(h('h4.memoria-sec-tit', 'Temas (' + ts.length + ')'));
      if (!ts.length) { zonaTemas.appendChild(h('p.ayuda', 'Todavía no hay temas. Aparecen cuando los agentes anotan algo o cuando el bibliotecario ordena la memoria.')); return; }
      ts.forEach(function (t) {
        var meta = plural(t.aportes, 'aporte', 'aportes') + (t.sinConsolidar ? ' · ' + t.sinConsolidar + ' sin ordenar' : '') + (t.consolidado ? ' · al ' + diaCorto(t.consolidado) : ' · sin ordenar') + (t.choques ? ' · ' + plural(t.choques, 'para decidir', 'para decidir') : '');
        zonaTemas.appendChild(h('button.memoria-tema' + (ver === t.slug ? '.activa' : ''), { type: 'button', 'data-slug': t.slug, onclick: function () { abrirTema(t); } },
          h('b', t.titulo), t.resumen ? h('span.memoria-tema-res', t.resumen) : null, h('span.memoria-tema-meta', meta)));
      });
    }
    function abrirTema(t) {
      var det = op.det;
      if (!det) { abrirArchivo('conocimiento/temas/' + t.slug + '.md'); return; }
      ver = t.slug;
      det.style.display = '';
      if (op.biblio) { op.biblio.classList.remove('sin-det'); op.biblio.classList.add('con-sel'); }
      App.add(App.vaciar(det), App.cargando('Abriendo el tema…'));
      api.get('/api/memoria/temas/' + encodeURIComponent(t.slug)).then(function (r) {
        var cuerpo = h('div.memoria-texto');
        App.htmlSeguro(cuerpo, App.markdown(String(r.texto).replace(/^<!--.*-->[ \t]*$/m, '')));
        App.add(App.vaciar(det),
          h('button.btn.chico.fantasma', { onclick: function () { cerrarTema(); } }, App.icono('atras'), 'Cerrar'),
          h('div.ayuda', 'Tema · ' + t.slug), cuerpo,
          App.acciones(null, [h('button.btn.chico.fantasma', { onclick: function () { abrirArchivo('conocimiento/temas/' + t.slug + '.md'); } }, App.icono('abrir'), 'Abrir el archivo')]));
        pintarTemasMarca();
      }).catch(function (e) { App.add(App.vaciar(det), h('div.vacio', e.message)); });
    }
    /* sin tema abierto el detalle no se muestra: la memoria usa todo el ancho */
    function sinDetalle() {
      ver = null;
      if (op.biblio) { op.biblio.classList.remove('con-sel'); op.biblio.classList.add('sin-det'); }
      if (op.det) { App.vaciar(op.det); op.det.style.display = 'none'; }
    }
    function cerrarTema() { sinDetalle(); pintarTemasMarca(); }
    function pintarTemasMarca() {
      Array.prototype.forEach.call(zonaTemas.querySelectorAll('.memoria-tema'), function (b) {
        b.classList.toggle('activa', !!ver && b.getAttribute('data-slug') === ver);
      });
    }

    /* «Preguntale»: solo lectura, con citas */
    function preguntale() {
      var campo = h('input.campo', { placeholder: 'Preguntale al bibliotecario', maxlength: 1000 });
      var salida = h('div.memoria-respuestas');
      var enviar = h('button.btn.primario', { onclick: preguntar }, App.icono('enviar'), 'Preguntar');
      var ocupado = false;
      function citada(r) {
        var nodos = [];
        String(r.respuesta).split(/(\[\d+\])/).forEach(function (parte) {
          var m = /^\[(\d+)\]$/.exec(parte);
          var c = m && (r.citas || []).filter(function (x) { return x.n === Number(m[1]); })[0];
          nodos.push(c ? h('button.memoria-cita', { type: 'button', title: c.titulo + ' · ' + c.ruta, onclick: function () { abrirArchivo(c.ruta); } }, '[' + c.n + ']') : parte);
        });
        return nodos;
      }
      function pintarRespuestas() {
        App.vaciar(salida);
        recientes.forEach(function (r) {
          salida.appendChild(h('div.con-item',
            h('div.con-cab', h('span.con-tit', r.pregunta)),
            h('div.con-resp', citada(r)),
            r.citas && r.citas.length ? h('div.con-acciones', h('span.ayuda', 'Fuentes:'), r.citas.map(function (c) {
              return h('button.btn.chico.fantasma', { type: 'button', title: c.ruta, onclick: function () { abrirArchivo(c.ruta); } }, '[' + c.n + '] ' + c.titulo + (c.fecha ? ' · ' + c.fecha : ''));
            })) : null));
        });
      }
      function preguntar() {
        var q = campo.value.trim();
        if (!q || ocupado) return;
        ocupado = true;
        enviar.disabled = true;
        salida.insertBefore(App.cargando('Buscando en la memoria…'), salida.firstChild);
        api.post('/api/memoria/preguntar', { pregunta: q }).then(function (r) {
          recientes.unshift({ pregunta: q, respuesta: r.respuesta, citas: r.citas || [] });
          recientes = recientes.slice(0, 5);
          campo.value = '';
        }).catch(App.fallo).then(function () { ocupado = false; enviar.disabled = false; pintarRespuestas(); });
      }
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') preguntar(); });
      pintarRespuestas();
      return h('div.memoria-pregunta',
        h('h4.memoria-sec-tit', 'Preguntale al bibliotecario'),
        h('div.memoria-pregunta-fila', campo, enviar),
        h('div.ayuda', 'Contesta con lo que está escrito en la oficina. No anota ni cambia nada.'),
        salida);
    }

    sinDetalle();
    refrescar();
  }

  App.Memoria = { pintar: pintar, contar: contar };
})();
