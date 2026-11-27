/* Memoria privada de la secretaría (docs/plan-secretaria.md, «Memoria de la secretaría»): en Ajustes › Secretaría, el bloque
   «Memoria» y la hoja con tres vistas: Seguimiento (temas por estado y fecha: cambiar el estado, ver el historial, editar,
   compartir con la oficina, borrar), Días (el diario y los resúmenes semanales) y Personas y cosas (fichas). Editar es
   escribir el .md tal cual. Es privada: no pasa por la Biblioteca ni por la memoria de la oficina salvo que se comparta acá.
   API: /api/secretaria/memoria (ver backend/API.md). */
(function () {
  var h = App.h;
  var api = function () { return App.api; };
  var base = '/api/secretaria/memoria';

  var ESTADOS = [['abierto', 'Abierto'], ['esperando', 'Esperando'], ['resuelto', 'Resuelto'], ['descartado', 'Descartado']];
  var nombreEstado = function (e) { return (ESTADOS.filter(function (x) { return x[0] === e; })[0] || [e, e])[1]; };
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  /* «2026-12-04 10:00» -> «4 dic 2026, 10:00» */
  function fechaCorta(f) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?$/.exec(f || '');
    if (!m) return f || '';
    return Number(m[3]) + ' ' + MESES[Number(m[2]) - 1] + ' ' + m[1] + (m[4] ? ', ' + m[4] : '');
  }
  function haceDias(n) { return n <= 0 ? 'hoy' : n === 1 ? 'ayer' : 'hace ' + n + ' días'; }

  /* ---------------- el .md: ver, editar ---------------- */
  /* Historial de un tema: las líneas «- fecha · [origen] texto» de la sección «## Historial» */
  function historialDe(md) {
    var out = [], dentro = false;
    md.split('\n').forEach(function (l) {
      var s = /^##\s+(.*)$/.exec(l);
      if (s) { dentro = s[1].trim().toLowerCase() === 'historial'; return; }
      if (dentro && /^- /.test(l)) out.push(l.slice(2));
    });
    return out;
  }

  /* Hoja con el .md en un textarea; guarda con PUT (reindexa). */
  function editar(ruta, titulo, alGuardar) {
    api().get(base + '/archivo', { ruta: ruta }).then(function (r) {
      var area = h('textarea.campo', { rows: 18, spellcheck: 'false', style: { width: '100%', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '12.5px', lineHeight: '1.5' } });
      area.value = r.texto;
      var err = h('div.error-txt');
      var hj = App.hoja({ titulo: 'Editar · ' + titulo, ancho: 640, clave: 'secretaria-memoria-editar' });
      App.add(hj.cuerpo,
        h('div.ajuste-ayuda', { style: { marginBottom: '8px' } }, 'Es el archivo tal cual: un título («# …»), campos «Clave: valor» y secciones «## …» con una línea «- fecha · [origen] texto» por cada cosa. Si te equivocás en el formato, te lo digo al guardar.'),
        area, err);
      var guardar = h('button.btn.primario', { onclick: function () {
        guardar.disabled = true; err.textContent = '';
        api().put(base + '/archivo', { ruta: ruta, texto: area.value }).then(function () {
          hj.cerrar(); App.guardado('Guardado.'); if (alGuardar) alGuardar();
        }).catch(function (e) { err.textContent = e.message; guardar.disabled = false; });
      } }, 'Guardar');
      App.add(hj.pie, h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), guardar);
    }).catch(App.fallo);
  }

  function borrar(ruta, titulo, texto, alBorrar) {
    return App.confirmar('¿Borrar «' + titulo + '»?', texto, 'Borrar', true).then(function (si) {
      if (!si) return;
      return api().del(base + '/archivo?ruta=' + encodeURIComponent(ruta)).then(function () { App.guardado('Borrado.'); if (alBorrar) alBorrar(); }).catch(App.fallo);
    });
  }

  function compartir(ruta, titulo, alCompartir) {
    return App.confirmar('¿Compartir «' + titulo + '» con la oficina?',
      'Se le pasa un resumen a la memoria de la oficina, que leen todos los agentes. La memoria de la secretaría sigue siendo privada y no se mueve nada de ahí.', 'Compartir').then(function (si) {
      if (!si) return;
      return api().post(base + '/compartir', { ruta: ruta }).then(function (r) { App.guardado('Compartido en la memoria de la oficina (' + r.tema + ').'); if (alCompartir) alCompartir(); }).catch(App.fallo);
    });
  }

  /* Ver un archivo (día, semana, ficha) con sus acciones */
  function ver(ruta, titulo, op, alCambiar) {
    op = op || {};
    api().get(base + '/archivo', { ruta: ruta }).then(function (r) {
      var hj = App.hoja({ titulo: titulo, ancho: 600, clave: 'secretaria-memoria-ver' });
      App.add(hj.cuerpo, h('pre', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'inherit', lineHeight: '1.55', fontSize: '13.5px' } }, r.texto));
      App.add(hj.pie,
        h('button.btn.fantasma', { onclick: function () { hj.cerrar(); borrar(ruta, titulo, op.borrar || 'Se borra de la memoria de la secretaría. No se puede deshacer.', alCambiar); } }, App.icono('papelera'), 'Borrar'),
        op.compartir ? h('button.btn', { onclick: function () { hj.cerrar(); compartir(ruta, titulo, alCambiar); } }, 'Compartir con la oficina') : null,
        h('button.btn', { onclick: function () { hj.cerrar(); editar(ruta, titulo, alCambiar); } }, App.icono('lapiz'), 'Editar'),
        h('button.btn.primario', { onclick: hj.cerrar }, 'Cerrar'));
    }).catch(App.fallo);
  }

  /* ---------------- la hoja ---------------- */
  function abrir(opciones) {
    opciones = opciones || {};
    var vivo = true, datos = null, vista = opciones.vista || 'seguimiento', filtro = 'abiertos';
    var hj = App.hoja({ titulo: 'Memoria de la secretaría', ancho: 780, alto: '82vh', clave: 'secretaria-memoria', alCerrar: function () { vivo = false; if (opciones.alCerrar) opciones.alCerrar(); } });
    var pestanas = h('div.pestanas', { style: { padding: 0, marginBottom: '10px' } });
    var caja = h('div', App.cargando('Abriendo la memoria…'));
    App.add(hj.cuerpo, h('div.ajuste-ayuda', { style: { marginBottom: '10px' } },
      'Lo que la secretaría va sabiendo de vos, de todas sus fuentes. Es privada: los demás agentes no la ven ni pasa por la Biblioteca; solo la comparte la oficina si vos lo decidís.'), pestanas, caja);

    function cargar() {
      return api().get(base).then(function (r) { if (vivo) { datos = r; dibujar(); } })
        .catch(function (e) { if (vivo) App.vaciar(caja).appendChild(h('div.error-txt', e.message)); });
    }
    function dibujar() {
      App.vaciar(pestanas);
      var sinMov = datos.temas.filter(function (t) { return t.trabado; }).length;
      [['seguimiento', 'Seguimiento', datos.temas.filter(function (t) { return t.estado === 'abierto' || t.estado === 'esperando'; }).length],
        ['dias', 'Días', datos.dias.length + datos.semanas.length], ['fichas', 'Personas y cosas', datos.fichas.length]].forEach(function (p) {
        pestanas.appendChild(h('button.pestana' + (vista === p[0] ? '.activa' : ''), { onclick: function () { vista = p[0]; dibujar(); } },
          p[1] + (p[2] ? ' (' + p[2] + ')' : ''), p[0] === 'seguimiento' && sinMov ? h('span.insignia.aviso', { style: { marginLeft: '6px' }, title: 'Trabados o con la fecha pasada' }, sinMov) : null));
      });
      App.vaciar(caja);
      if (vista === 'seguimiento') seguimiento(); else if (vista === 'dias') dias(); else fichas();
    }

    function fila(contenido, acciones) {
      return h('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--linea)' } },
        h('div', { style: { flex: 1, minWidth: 0 } }, contenido), h('div', { style: { display: 'flex', gap: '2px', flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' } }, acciones));
    }
    var iconoBtn = function (icono, titulo, fn) { return h('button.btn.chico.fantasma.icono', { title: titulo, onclick: fn }, App.icono(icono)); };

    /* ---- Seguimiento ---- */
    function seguimiento() {
      if (datos.sugerencias.length) {
        datos.sugerencias.forEach(function (s) {
          caja.appendChild(h('div', { style: { border: '1px solid var(--linea-fuerte)', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px', background: 'var(--panel-2)' } },
            h('div', { style: { fontWeight: 500 } }, 'La secretaria sugiere compartir ' + (s.tipo === 'tema' ? 'el tema' : 'la ficha') + ' «' + s.titulo + '» con la oficina'),
            h('div.ajuste-ayuda', { style: { margin: '2px 0 8px' } }, s.motivo),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('button.btn.chico.primario', { onclick: function () { compartir((s.tipo === 'tema' ? 'temas/' : 'fichas/') + s.slug + '.md', s.titulo, cargar); } }, 'Compartir'),
              h('button.btn.chico', { onclick: function () { api().post(base + '/sugerencia/descartar', { ruta: (s.tipo === 'tema' ? 'temas/' : 'fichas/') + s.slug + '.md' }).then(cargar).catch(App.fallo); } }, 'Ahora no'))));
        });
      }
      var sel = h('select.campo', { style: { width: 'auto' } },
        h('option', { value: 'abiertos', selected: filtro === 'abiertos' }, 'Abiertos y esperando'),
        h('option', { value: 'trabados', selected: filtro === 'trabados' }, 'Trabados o con la fecha pasada'),
        ESTADOS.slice(2).map(function (e) { return h('option', { value: e[0], selected: filtro === e[0] }, e[1] + 's'); }),
        h('option', { value: 'todos', selected: filtro === 'todos' }, 'Todos'));
      sel.addEventListener('change', function () { filtro = sel.value; dibujar(); });
      caja.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' } }, h('span', 'Mostrar'), sel,
        h('span.ajuste-ayuda', { style: { flex: 1 } }, 'Si algo lleva más de ' + datos.limites.diasSinMovimiento + ' días sin moverse o ya pasó su fecha, la secretaria lo marca en su reporte («Seguimiento»).')));
      var temas = datos.temas.filter(function (t) {
        if (filtro === 'abiertos') return t.estado === 'abierto' || t.estado === 'esperando';
        if (filtro === 'trabados') return t.trabado;
        return filtro === 'todos' || t.estado === filtro;
      });
      /* con fecha primero (la más próxima), después por movimiento */
      temas.sort(function (a, b) { return (a.fecha ? 0 : 1) - (b.fecha ? 0 : 1) || (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0); });
      if (!temas.length) caja.appendChild(h('div.vacio', filtro === 'abiertos' ? 'No hay temas abiertos. La secretaria los va armando sola cuando revisa tus fuentes y cuando charlás con ella.' : 'No hay temas así.'));
      temas.forEach(function (t) { caja.appendChild(tema(t)); });
    }

    function tema(t) {
      var ruta = 'temas/' + t.slug + '.md';
      var estado = h('select.campo', { style: { width: 'auto', height: '26px', padding: '0 6px', fontSize: '12px' }, title: 'Cambiar el estado' },
        ESTADOS.map(function (e) { return h('option', { value: e[0], selected: t.estado === e[0] }, e[1]); }));
      estado.addEventListener('change', function () {
        api().post(base + '/tema', { slug: t.slug, estado: estado.value }).then(function () { App.guardado('«' + t.titulo + '» pasó a ' + nombreEstado(estado.value).toLowerCase() + '.'); return cargar(); }).catch(function (e) { App.fallo(e); dibujar(); });
      });
      var historial = h('div', { style: { display: 'none', margin: '8px 0 0', padding: '8px 10px', background: 'var(--panel-2)', borderRadius: '8px', fontSize: '12.5px', lineHeight: '1.5' } });
      var cargado = false;
      var ver_ = h('button.btn.chico.fantasma', { onclick: function () {
        var abierto = historial.style.display !== 'none';
        historial.style.display = abierto ? 'none' : 'block';
        ver_.textContent = abierto ? 'Historial' : 'Ocultar';
        if (abierto || cargado) return;
        cargado = true; historial.textContent = 'Cargando…';
        api().get(base + '/archivo', { ruta: ruta }).then(function (r) {
          App.vaciar(historial);
          var ls = historialDe(r.texto);
          if (!ls.length) historial.textContent = 'Todavía no tiene historial.';
          ls.forEach(function (l) {
            var m = /^(\d{4}-\d{2}-\d{2}) · (?:\[([^\]]*)\] )?(.*)$/.exec(l);
            historial.appendChild(m ? h('div', { style: { padding: '2px 0' } }, h('span', { style: { color: 'var(--suave)' } }, fechaCorta(m[1]) + (m[2] ? ' · ' + m[2] : '') + ' — '), m[3]) : h('div', l));
          });
        }).catch(function (e) { historial.textContent = e.message; cargado = false; });
      } }, 'Historial');
      var cuando = t.fecha ? [h('span', { style: { fontWeight: 500 } }, fechaCorta(t.fecha))] : [];
      return fila([
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, h('span', { style: { fontWeight: 500 } }, t.titulo), estado,
          t.trabado ? h('span.insignia.aviso', t.fecha && t.fecha.slice(0, 10) < hoy() ? 'Fecha pasada' : 'Sin movimiento') : null),
        h('div.ajuste-ayuda', { style: { marginTop: '2px' } }, cuando.concat([
          t.proximo ? [cuando.length ? ' · ' : '', 'Próximo: ' + t.proximo] : null,
          t.personas.length ? ' · con ' + t.personas.join(', ') : null,
          ' · se movió ' + haceDias(t.diasSinMovimiento)])),
        historial,
      ], [ver_,
        iconoBtn('lapiz', 'Editar', function () { editar(ruta, t.titulo, cargar); }),
        iconoBtn('abrir', 'Compartir con la oficina', function () { compartir(ruta, t.titulo, cargar); }),
        iconoBtn('papelera', 'Borrar', function () { borrar(ruta, t.titulo, 'Se borra el tema y su historial de la memoria de la secretaría. No se puede deshacer.', cargar); })]);
    }
    function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

    /* ---- Días ---- */
    function dias() {
      var pend = datos.pendientes || {};
      caja.appendChild(h('div.ajuste-ayuda', { style: { marginBottom: '6px' } },
        'Cada revisión anota en el diario lo relevante de cada fuente, con su origen. En la primera revisión del día resume el día anterior, y los días de más de ' + datos.limites.diasCondensar + ' días se juntan en un resumen por semana (y se borran).'
        + (pend.dia ? ' Falta resumir el ' + fechaCorta(pend.dia) + '.' : '') + (pend.semana ? ' Falta condensar la semana ' + pend.semana.semana + '.' : '')));
      if (!datos.dias.length && !datos.semanas.length) caja.appendChild(h('div.vacio', 'Todavía no hay nada anotado.'));
      datos.dias.forEach(function (d) {
        var ruta = 'diario/' + d.dia + '.md';
        caja.appendChild(fila([h('span', { style: { fontWeight: 500 } }, fechaCorta(d.dia)),
          h('span.ajuste-ayuda', { style: { marginLeft: '8px' } }, d.entradas + (d.entradas === 1 ? ' anotación' : ' anotaciones') + (d.resumen ? ' · con resumen' : ''))],
        [h('button.btn.chico.fantasma', { onclick: function () { ver(ruta, 'Diario del ' + fechaCorta(d.dia), { borrar: 'Se borra este día del diario. No se puede deshacer.' }, cargar); } }, 'Ver'),
          iconoBtn('lapiz', 'Editar', function () { editar(ruta, 'Diario del ' + fechaCorta(d.dia), cargar); }),
          iconoBtn('papelera', 'Borrar', function () { borrar(ruta, 'Diario del ' + fechaCorta(d.dia), 'Se borra este día del diario. No se puede deshacer.', cargar); })]));
      });
      if (datos.semanas.length) caja.appendChild(h('h4.seccion-tit', { style: { marginTop: '14px' } }, h('span', 'Semanas resumidas')));
      datos.semanas.forEach(function (s) {
        var ruta = 'semanas/' + s.semana + '.md', t = 'Semana del ' + fechaCorta(s.desde) + ' al ' + fechaCorta(s.hasta);
        caja.appendChild(fila([h('span', { style: { fontWeight: 500 } }, t), h('span.ajuste-ayuda', { style: { marginLeft: '8px' } }, s.semana)],
          [h('button.btn.chico.fantasma', { onclick: function () { ver(ruta, t, { borrar: 'Se borra el resumen de esa semana (los días ya no están). No se puede deshacer.' }, cargar); } }, 'Ver'),
            iconoBtn('lapiz', 'Editar', function () { editar(ruta, t, cargar); }),
            iconoBtn('papelera', 'Borrar', function () { borrar(ruta, t, 'Se borra el resumen de esa semana (los días ya no están). No se puede deshacer.', cargar); })]));
      });
    }

    /* ---- Personas y cosas ---- */
    function fichas() {
      caja.appendChild(h('div.ajuste-ayuda', { style: { marginBottom: '6px' } }, 'Datos estables, cada uno con su fecha y de dónde salió: con quién se atiende mamá, cuándo vencen las cuotas del colegio.'));
      if (!datos.fichas.length) caja.appendChild(h('div.vacio', 'Todavía no hay fichas.'));
      datos.fichas.forEach(function (f) {
        var ruta = 'fichas/' + f.slug + '.md';
        caja.appendChild(fila([h('span', { style: { fontWeight: 500 } }, f.nombre), h('span.insignia', { style: { marginLeft: '8px' } }, f.tipo),
          h('span.ajuste-ayuda', { style: { marginLeft: '8px' } }, f.datos + (f.datos === 1 ? ' dato' : ' datos') + ' · ' + fechaCorta(f.actualizado))],
        [h('button.btn.chico.fantasma', { onclick: function () { ver(ruta, f.nombre, { compartir: true, borrar: 'Se borra la ficha de la memoria de la secretaría. No se puede deshacer.' }, cargar); } }, 'Ver'),
          iconoBtn('lapiz', 'Editar', function () { editar(ruta, f.nombre, cargar); }),
          iconoBtn('abrir', 'Compartir con la oficina', function () { compartir(ruta, f.nombre, cargar); }),
          iconoBtn('papelera', 'Borrar', function () { borrar(ruta, f.nombre, 'Se borra la ficha de la memoria de la secretaría. No se puede deshacer.', cargar); })]));
      });
    }

    /* pie: mostrar la carpeta, borrar todo */
    if (App.nativo && App.nativo.revelar) {
      App.add(hj.pie, h('button.btn', { onclick: function () {
        api().post(base + '/carpeta', {}).then(function (r) { App.nativo.revelar(r.ruta); }).catch(App.fallo);
      } }, App.icono('carpeta'), 'Mostrar la carpeta'));
    }
    App.add(hj.pie,
      h('button.btn.fantasma.peligro', { style: { marginRight: 'auto' }, onclick: function () { borrarTodo(cargar); } }, 'Borrar la memoria'),
      h('button.btn.primario', { onclick: hj.cerrar }, 'Listo'));
    cargar();
  }

  function borrarTodo(alBorrar) {
    return App.confirmar('¿Borrar toda la memoria de la secretaría?', 'Se borran su diario, los temas en seguimiento y las fichas. No se puede deshacer, y la secretaria empieza de cero. Lo que ya compartiste con la oficina queda ahí.', 'Borrar la memoria', true).then(function (si) {
      if (!si) return;
      return api().del(base).then(function () { App.guardado('La memoria de la secretaría quedó vacía.'); if (alBorrar) alBorrar(); }).catch(App.fallo);
    });
  }

  /* ---------------- bloque para Ajustes › Secretaría ---------------- */
  /* `siempre`: mostrarlo aunque todavía no haya nada (con secretaría). Sin eso, solo si hay memoria guardada. */
  function bloque(siempre) {
    var caja = h('div');
    function cargar() {
      api().get(base).then(function (r) {
        App.vaciar(caja);
        var abiertos = r.temas.filter(function (t) { return t.estado === 'abierto' || t.estado === 'esperando'; }).length;
        var trabados = r.temas.filter(function (t) { return t.trabado; }).length;
        var vacia = !r.temas.length && !r.dias.length && !r.fichas.length && !r.semanas.length;
        if (vacia && !siempre) return;
        var resumen = vacia ? 'Todavía no anotó nada: empieza en la próxima revisión.'
          : abiertos + (abiertos === 1 ? ' tema abierto' : ' temas abiertos') + (trabados ? ' (' + trabados + (trabados === 1 ? ' trabado' : ' trabados') + ')' : '') + ' · ' + r.fichas.length + (r.fichas.length === 1 ? ' ficha' : ' fichas') + ' · ' + r.dias.length + (r.dias.length === 1 ? ' día' : ' días') + ' en el diario'
          + (r.sugerencias.length ? ' · ' + r.sugerencias.length + (r.sugerencias.length === 1 ? ' sugerencia para compartir' : ' sugerencias para compartir') : '');
        caja.appendChild(h('div.ajuste', { style: { display: 'block' } },
          h('div.ajuste-tit', 'Memoria'),
          h('div.ajuste-ayuda', { style: { margin: '2px 0 8px' } }, 'Lo que la secretaria va sabiendo de vos, de WhatsApp, Gmail, el calendario y la charla con ella: un diario, los temas en seguimiento y fichas de personas y cosas. Es privada: no la ven los demás agentes ni pasa por la Biblioteca.'),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
            h('button.btn', { onclick: function () { abrir({ alCerrar: cargar }); } }, App.icono('carpeta'), 'Ver la memoria'),
            h('span.ajuste-ayuda', { style: { flex: 1 } }, resumen))));
      }).catch(function () {});
    }
    cargar();
    return caja;
  }

  App.SecretariaMemoria = { abrir: abrir, bloque: bloque };
})();
