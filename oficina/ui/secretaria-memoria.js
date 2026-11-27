/* Memoria privada de la secretaría (docs/plan-secretaria.md, «Memoria de la secretaría»): en Ajustes › Secretaría, el bloque
   «Memoria» y la hoja con tres vistas: Seguimiento (temas por estado y fecha: cambiar el estado, ver el historial, editar,
   compartir con la oficina, borrar), Días (el diario, los resúmenes por semana y por mes, el archivo y el estado de la
   pasada diaria de orden, con «Ordenar ahora») y Personas y cosas (fichas). Editar es escribir el .md tal cual. Es privada:
   no pasa por la Biblioteca ni por la memoria de la oficina salvo que se comparta acá.
   «Importar notas…»: pasa una carpeta de notas de la compu (Obsidian, etc.) a esta memoria, en segundo plano y con progreso.
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
        op.recuperar ? h('button.btn', { onclick: function () { hj.cerrar(); op.recuperar(); } }, 'Recuperar') : null,
        op.recuperar ? null : h('button.btn', { onclick: function () { hj.cerrar(); editar(ruta, titulo, alCambiar); } }, App.icono('lapiz'), 'Editar'),
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
        ['dias', 'Días', datos.dias.length + datos.semanas.length + (datos.meses || []).length], ['fichas', 'Personas y cosas', datos.fichas.length]].forEach(function (p) {
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
            h('div', { style: { fontWeight: 500 } }, 'La secretaría sugiere compartir ' + (s.tipo === 'tema' ? 'el tema' : 'la ficha') + ' «' + s.titulo + '» con la oficina'),
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
        h('span.ajuste-ayuda', { style: { flex: 1 } }, 'Si algo lleva más de ' + datos.limites.diasSinMovimiento + ' días sin moverse o ya pasó su fecha, la secretaría lo marca en su reporte («Seguimiento»).')));
      var temas = datos.temas.filter(function (t) {
        if (filtro === 'abiertos') return t.estado === 'abierto' || t.estado === 'esperando';
        if (filtro === 'trabados') return t.trabado;
        return filtro === 'todos' || t.estado === filtro;
      });
      /* con fecha primero (la más próxima), después por movimiento */
      temas.sort(function (a, b) { return (a.fecha ? 0 : 1) - (b.fecha ? 0 : 1) || (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0); });
      if (!temas.length) caja.appendChild(h('div.vacio', filtro === 'abiertos' ? 'No hay temas abiertos. La secretaría los va armando cuando revisa tus fuentes y cuando charlan.' : 'No hay temas así.'));
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
    /* La pasada diaria de orden: cómo terminó la última, qué falta y el botón «Ordenar ahora». */
    function estadoOrden() {
      var pend = datos.pendientes || {}, orden = datos.orden || {}, u = orden.ultima;
      var faltan = [];
      if (pend.dias && pend.dias.length) faltan.push(pend.dias.length + (pend.dias.length === 1 ? ' día por resumir' : ' días por resumir'));
      if (pend.semanas && pend.semanas.length) faltan.push(pend.semanas.length + (pend.semanas.length === 1 ? ' semana por condensar' : ' semanas por condensar'));
      if (pend.meses && pend.meses.length) faltan.push(pend.meses.length + (pend.meses.length === 1 ? ' mes por juntar' : ' meses por juntar'));
      var linea;
      if (orden.corriendo) linea = 'Ordenando la memoria ahora…';
      else if (!u) linea = 'Todavía no se ordenó.';
      else {
        var cuando = u.terminada ? new Date(u.terminada * 1000) : new Date(u.creada * 1000);
        var hechos = [];
        if (u.hechos.dias) hechos.push(u.hechos.dias + (u.hechos.dias === 1 ? ' día resumido' : ' días resumidos'));
        if (u.hechos.semanas) hechos.push(u.hechos.semanas + (u.hechos.semanas === 1 ? ' semana condensada' : ' semanas condensadas'));
        if (u.hechos.meses) hechos.push(u.hechos.meses + (u.hechos.meses === 1 ? ' mes juntado' : ' meses juntados'));
        var temas = u.temasNuevos.length + u.temasActualizados.length;
        if (temas) hechos.push(temas + (temas === 1 ? ' tema puesto al día' : ' temas puestos al día'));
        var como = { ok: 'terminó bien', incompleta: 'quedó a medias (se reintenta en un rato)', error: 'falló (se reintenta en un rato)', incierta: 'se cortó al cerrar la app' }[u.estado] || u.estado;
        linea = 'Última vez: ' + fechaCorta(u.dia) + ' a las ' + ('0' + cuando.getHours()).slice(-2) + ':' + ('0' + cuando.getMinutes()).slice(-2) + ', ' + como + (hechos.length ? ' · ' + hechos.join(', ') : '') + '.';
      }
      var boton = h('button.btn.chico', { disabled: !!orden.corriendo, onclick: function () {
        boton.disabled = true;
        api().post(base + '/ordenar', {}).then(function (r) {
          App.guardado(r.orden ? 'La secretaría está ordenando su memoria.' : r.motivo);
          return cargar();
        }).catch(function (e) { App.fallo(e); boton.disabled = false; });
      } }, 'Ordenar ahora');
      return h('div', { style: { border: '1px solid var(--linea)', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center' } },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontWeight: 500 } }, 'Orden de la memoria'),
          h('div.ajuste-ayuda', linea + (faltan.length ? ' Falta: ' + faltan.join(', ') + '.' : ' No falta nada.'))),
        boton);
    }
    /* mientras ordena, refresca cada tanto hasta que termine */
    var siguiendo = false;
    function seguir() {
      if (siguiendo || !vivo || !datos.orden || !datos.orden.corriendo) return;
      siguiendo = true;
      setTimeout(function () { siguiendo = false; if (vivo) cargar(); }, 4000);
    }

    function dias() {
      caja.appendChild(h('div.ajuste-ayuda', { style: { marginBottom: '8px' } },
        'Cada revisión anota en el diario lo relevante de cada fuente, con su origen. Una vez por día la secretaría ordena su memoria: resume los días, junta los de más de '
        + datos.limites.diasCondensar + ' días en un resumen por semana y, pasados ' + Math.round(datos.limites.diasMeses / 30) + ' meses, las semanas en un resumen por mes. Con lo que lee pone al día los temas. Lo que condensa queda '
        + datos.limites.diasArchivo + ' días en el archivo, por si hace falta recuperarlo.'));
      caja.appendChild(estadoOrden());
      var meses = datos.meses || [], archivo = datos.archivo || [];
      if (!datos.dias.length && !datos.semanas.length && !meses.length) caja.appendChild(h('div.vacio', 'Todavía no hay nada anotado.'));
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
          [h('button.btn.chico.fantasma', { onclick: function () { ver(ruta, t, { borrar: 'Se borra el resumen de esa semana. Sus días, si siguen en el archivo, se pueden recuperar. No se puede deshacer.' }, cargar); } }, 'Ver'),
            iconoBtn('lapiz', 'Editar', function () { editar(ruta, t, cargar); }),
            iconoBtn('papelera', 'Borrar', function () { borrar(ruta, t, 'Se borra el resumen de esa semana. Sus días, si siguen en el archivo, se pueden recuperar. No se puede deshacer.', cargar); })]));
      });
      if (meses.length) caja.appendChild(h('h4.seccion-tit', { style: { marginTop: '14px' } }, h('span', 'Meses resumidos')));
      meses.forEach(function (m) {
        var ruta = 'meses/' + m.mes + '.md';
        var nombre = new Date(Number(m.mes.slice(0, 4)), Number(m.mes.slice(5, 7)) - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
        var t = nombre.charAt(0).toUpperCase() + nombre.slice(1);
        caja.appendChild(fila([h('span', { style: { fontWeight: 500 } }, t)],
          [h('button.btn.chico.fantasma', { onclick: function () { ver(ruta, t, { borrar: 'Se borra el resumen de ese mes. No se puede deshacer.' }, cargar); } }, 'Ver'),
            iconoBtn('lapiz', 'Editar', function () { editar(ruta, t, cargar); }),
            iconoBtn('papelera', 'Borrar', function () { borrar(ruta, t, 'Se borra el resumen de ese mes. No se puede deshacer.', cargar); })]));
      });
      if (archivo.length) {
        caja.appendChild(h('h4.seccion-tit', { style: { marginTop: '14px' } }, h('span', 'Archivo')));
        caja.appendChild(h('div.ajuste-ayuda', { style: { marginBottom: '4px' } }, 'Lo que ya quedó en un resumen. Se borra solo; si un resumen salió mal, recuperalo y la próxima pasada lo vuelve a condensar.'));
      }
      archivo.forEach(function (x) {
        var ruta = 'archivo/' + x.nombre + '.md';
        var t = x.tipo === 'dia' ? 'Diario del ' + fechaCorta(x.nombre) : 'Semana ' + x.nombre;
        var recuperar = function () {
          api().post(base + '/recuperar', { nombre: x.nombre }).then(function () { App.guardado('Recuperado: «' + t + '» volvió a la memoria.'); return cargar(); }).catch(App.fallo);
        };
        caja.appendChild(fila([h('span', t), h('span.ajuste-ayuda', { style: { marginLeft: '8px' } }, x.borra ? 'se borra el ' + fechaCorta(x.borra) : '')],
          [h('button.btn.chico.fantasma', { onclick: function () { ver(ruta, t, { recuperar: recuperar, borrar: 'Se borra ya del archivo. No se puede deshacer.' }, cargar); } }, 'Ver'),
            h('button.btn.chico.fantasma', { onclick: recuperar }, 'Recuperar')]));
      });
      seguir();
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
      h('button.btn', { onclick: function () { importar(cargar); } }, App.icono('abrir'), 'Importar notas…'),
      h('button.btn.primario', { onclick: hj.cerrar }, 'Listo'));
    cargar();
  }

  /* ---------------- importar notas ---------------- */
  /* Una carpeta de notas de tu compu (por ejemplo de Obsidian) que la secretaría lee y ordena en su memoria. Nunca se toca la
     carpeta: solo se lee. Primero «Analizar» (cuántos archivos y cuánto texto, sin gastar nada), después confirmar. En segundo
     plano, por tandas, con progreso y «Cancelar». API: /api/secretaria/memoria/importar* (ver backend/API.md). */
  var imp = '/importar';
  function num(n) { return Number(n || 0).toLocaleString('es-AR'); }
  function plural(n, uno, varios) { return num(n) + ' ' + (n === 1 ? uno : varios); }
  var ESTADO_IMP = { pendiente: 'Por empezar', corriendo: 'Importando', terminada: 'Terminada', fallida: 'Falló', cancelada: 'Cancelada', cortada: 'Se cortó' };

  function importar(alCerrar) {
    var vivo = true, timer = null, analisis = null, ruta = '';
    var hj = App.hoja({ titulo: 'Importar notas a la memoria', ancho: 640, clave: 'secretaria-memoria-importar', alCerrar: function () { vivo = false; if (timer) clearTimeout(timer); if (alCerrar) alCerrar(); } });
    var caja = h('div'), err = h('div.error-txt');
    App.add(hj.cuerpo, caja, err);
    App.add(hj.pie, h('button.btn.primario', { onclick: hj.cerrar }, 'Cerrar'));

    function cargar() {
      return api().get(base + imp).then(function (r) { if (vivo) dibujar(r); })
        .catch(function (e) { if (vivo) { App.vaciar(caja); caja.appendChild(h('div.error-txt', e.message)); } });
    }
    function sondear() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { if (vivo) cargar(); }, 2000);
    }

    function dibujar(r) {
      App.vaciar(caja); err.textContent = '';
      var u = r.importacion;
      if (u && (u.estado === 'pendiente' || u.estado === 'corriendo')) { progreso(u); sondear(); return; }
      if (u && u.estado === 'cortada') cortada(u);
      else if (u) ultima(u);
      formulario(r, u);
    }

    /* ---- en curso ---- */
    function progreso(u) {
      var pct = u.tandasTotal ? Math.round(100 * u.tandasHechas / u.tandasTotal) : 0;
      caja.appendChild(h('div.ajuste-tit', u.cancelando ? 'Cancelando…' : 'Importando las notas…'));
      caja.appendChild(h('div.ajuste-ayuda', { style: { margin: '2px 0 10px' } }, 'De «' + u.carpeta + '»: ' + plural(u.archivos, 'archivo', 'archivos') + ' en ' + plural(u.tandasTotal, 'tanda', 'tandas')
        + '. Sigue sola, aunque cierres esta ventana. ' + (u.cancelando ? 'La tanda que está corriendo termina y no sale ninguna más.' : 'Podés seguir usando la oficina.')));
      caja.appendChild(h('div', { style: { height: '10px', borderRadius: '6px', background: 'var(--panel-2)', border: '1px solid var(--linea)', overflow: 'hidden' } },
        h('div', { style: { height: '100%', width: pct + '%', background: 'var(--acento, #0a5fb4)', transition: 'width .3s' } })));
      caja.appendChild(h('div.ajuste-ayuda', { style: { margin: '6px 0 10px' } }, 'Tanda ' + Math.min(u.tandasHechas + 1, u.tandasTotal) + ' de ' + u.tandasTotal + ' · ' + pct + '%'
        + ' · ' + plural(u.resultado.temasNuevos + u.resultado.temasActualizados, 'tema', 'temas') + ', ' + plural(u.resultado.fichasNuevas + u.resultado.fichasActualizadas, 'ficha', 'fichas') + ' y ' + plural(u.resultado.dias, 'día', 'días') + ' del diario hasta ahora'
        + (u.errores.length ? ' · ' + plural(u.errores.length, 'tanda con error', 'tandas con error') : '')));
      var cancelar = h('button.btn', { disabled: !!u.cancelando, onclick: function () {
        cancelar.disabled = true;
        api().post(base + imp + '/cancelar', {}).then(cargar).catch(function (e) { err.textContent = e.message; cancelar.disabled = false; });
      } }, u.cancelando ? 'Cancelando…' : 'Cancelar');
      caja.appendChild(cancelar);
    }

    /* ---- se cortó: se puede seguir ---- */
    function cortada(u) {
      caja.appendChild(h('div', { style: { border: '1px solid var(--linea-fuerte)', borderRadius: '10px', padding: '10px 12px', marginBottom: '12px', background: 'var(--panel-2)' } },
        h('div', { style: { fontWeight: 500 } }, 'La importación se cortó en la tanda ' + (u.tandasHechas + 1) + ' de ' + u.tandasTotal),
        h('div.ajuste-ayuda', { style: { margin: '2px 0 8px' } }, 'Se cerró la app a mitad. Lo que ya se importó está guardado y no se repite: seguís desde donde quedó, o la dejás así.'),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button.btn.chico.primario', { onclick: function () { api().post(base + imp + '/reanudar', {}).then(cargar).catch(function (e) { err.textContent = e.message; }); } }, 'Seguir'),
          h('button.btn.chico', { onclick: function () { api().post(base + imp + '/cancelar', {}).then(cargar).catch(function (e) { err.textContent = e.message; }); } }, 'Dejarla así'))));
    }

    /* ---- la última importación ---- */
    function ultima(u) {
      var r = u.resultado;
      var detalle = u.estado === 'terminada' || u.estado === 'cancelada' || u.estado === 'fallida'
        ? plural(r.temasNuevos, 'tema nuevo', 'temas nuevos') + ' y ' + num(r.temasActualizados) + ' actualizados · ' + plural(r.fichasNuevas, 'ficha nueva', 'fichas nuevas') + ' y ' + num(r.fichasActualizadas) + ' actualizadas · ' + plural(r.dias, 'día', 'días') + ' del diario'
        : '';
      caja.appendChild(h('div', { style: { border: '1px solid var(--linea)', borderRadius: '10px', padding: '10px 12px', marginBottom: '12px' } },
        h('div', { style: { fontWeight: 500 } }, 'Última importación: ' + (ESTADO_IMP[u.estado] || u.estado).toLowerCase() + ' · «' + u.carpeta + '»'),
        h('div.ajuste-ayuda', { style: { margin: '2px 0' } }, plural(u.archivos, 'archivo', 'archivos') + ' · ' + plural(u.tandasHechas, 'tanda', 'tandas') + ' de ' + num(u.tandasTotal) + (detalle ? ' · ' + detalle : '')),
        u.errores.length ? h('div.error-txt', plural(u.errores.length, 'tanda no se pudo hacer', 'tandas no se pudieron hacer') + ': ' + u.errores.map(function (e) { return e.mensaje; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 2).join(' · ')) : null,
        h('div', { style: { marginTop: '8px' } }, h('button.btn.chico', { onclick: function () { ruta = u.carpeta; analizar(true); } }, 'Volver a importar'),
          h('span.ajuste-ayuda', { style: { marginLeft: '8px' } }, 'Procesa solo lo nuevo o lo que cambió.'))));
    }

    /* ---- elegir la carpeta y analizar ---- */
    function formulario(r, u) {
      if (!r.secretaria) {
        caja.appendChild(h('div.vacio', 'Primero configurá la secretaría (Ajustes › Secretaría): la importación la hace quien la atiende.'));
        return;
      }
      if (!ruta && u) ruta = u.carpeta;
      var campo = h('input.campo', { type: 'text', placeholder: '/Users/vos/Documents/Obsidian/Notas', spellcheck: 'false', value: ruta, style: { flex: 1 } });
      campo.addEventListener('input', function () { ruta = campo.value; if (analisis) { analisis = null; App.vaciar(resultado); } });
      campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') analizar(false); });
      var elegir = App.elegirCarpeta ? h('button.btn', { onclick: function () {
        App.elegirCarpeta('Elegí la carpeta con las notas', { inicio: ruta || undefined }).then(function (x) { if (x) { ruta = x; campo.value = x; analizar(false); } });
      } }, App.icono('carpeta'), 'Elegir…') : null;
      caja.appendChild(h('div.ajuste-tit', 'Una carpeta de notas'));
      caja.appendChild(h('div.ajuste-ayuda', { style: { margin: '2px 0 8px' } },
        'Pasá a la memoria de la secretaría lo que tengas anotado en otro lado: resúmenes por día, datos de salud, trámites… Lee los .md, .txt, PDF y Word de la carpeta y sus subcarpetas (no las ocultas ni las imágenes) y lo ordena en fichas, temas en seguimiento y el diario. La carpeta no se toca: solo se lee. Tiene que estar en esta misma compu.'));
      caja.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, campo, elegir,
        h('button.btn.primario', { onclick: function () { analizar(false); } }, 'Analizar')));
      resultado = h('div', { style: { marginTop: '12px' } });
      caja.appendChild(resultado);
    }
    var resultado = h('div');

    function analizar(desdeUltima) {
      if (!ruta.trim()) { err.textContent = 'Poné la ruta de la carpeta con las notas.'; return; }
      err.textContent = '';
      var pedido = ruta;
      App.vaciar(resultado).appendChild(App.cargando('Leyendo la carpeta…'));
      api().post(base + imp + '/analizar', { ruta: pedido }).then(function (a) {
        if (!vivo || pedido !== ruta) return;
        analisis = a; App.vaciar(resultado); mostrarAnalisis(a, desdeUltima);
      }).catch(function (e) { App.vaciar(resultado); err.textContent = e.message; });
    }

    function mostrarAnalisis(a, desdeUltima) {
      if (a.activa) { resultado.appendChild(h('div.vacio', 'Ya hay una importación en curso.')); return; }
      var partes = [];
      if (a.iguales) partes.push(plural(a.iguales, 'ya está importado', 'ya están importados'));
      if (a.nuevos && a.cambiados) partes.push(num(a.nuevos) + ' nuevos y ' + num(a.cambiados) + ' cambiados');
      var cuadro = h('div', { style: { border: '1px solid var(--linea-fuerte)', borderRadius: '10px', padding: '10px 12px', background: 'var(--panel-2)' } });
      if (!a.archivos) {
        cuadro.appendChild(h('div', { style: { fontWeight: 500 } }, a.iguales ? 'No hay nada nuevo para importar' : 'No encontré archivos de texto para importar'));
        cuadro.appendChild(h('div.ajuste-ayuda', a.iguales ? 'Todo lo de esa carpeta ya está en la memoria de la secretaría.' : 'Busqué .md, .txt, PDF, Word y similares, sin las carpetas ocultas.'));
      } else {
        cuadro.appendChild(h('div', { style: { fontWeight: 500 } }, (desdeUltima || a.iguales ? 'Hay para importar: ' : 'Para importar: ') + plural(a.archivos, 'archivo', 'archivos') + ', ' + num(a.caracteres) + ' caracteres'));
        cuadro.appendChild(h('div.ajuste-ayuda', { style: { margin: '2px 0 4px' } }, 'Va en ' + plural(a.tandas, 'tanda', 'tandas') + ' de unos ' + num(a.tandaChars) + ' caracteres' + (partes.length ? ' · ' + partes.join(' · ') : '') + '.'));
        cuadro.appendChild(h('div.ajuste-ayuda', { style: { margin: '4px 0 8px' } },
          'Ojo: usa Claude en proporción al texto. Cada tanda es una corrida de ' + (a.secretaria ? a.secretaria.nombre : 'la secretaría') + ' con su memoria (un chat de unos minutos), así que ' + plural(a.tandas, 'tanda gasta', 'tandas gastan') + ' del plan, y las notas largas más. Corre en segundo plano y la podés cancelar. Lo que importa es lo que va a la memoria, no una copia de las notas.'));
        var ir = h('button.btn.primario', { onclick: function () {
          ir.disabled = true;
          api().post(base + imp + '/empezar', { ruta: a.carpeta }).then(function () { App.guardado('Empezó la importación.'); return cargar(); })
            .catch(function (e) { err.textContent = e.message; ir.disabled = false; });
        } }, 'Importar ' + plural(a.archivos, 'archivo', 'archivos'));
        cuadro.appendChild(ir);
      }
      resultado.appendChild(cuadro);
      if (a.salteadosTotal) {
        var por = Object.keys(a.resumenSalteados || {}).map(function (m) { return a.resumenSalteados[m] + ' ' + m; }).join(' · ');
        var lista = h('div', { style: { display: 'none', margin: '6px 0 0', padding: '8px 10px', background: 'var(--panel-2)', borderRadius: '8px', fontSize: '12.5px', lineHeight: '1.5', maxHeight: '180px', overflow: 'auto' } },
          a.salteados.map(function (s) { return h('div', h('span', { style: { color: 'var(--suave)' } }, s.motivo + ' — '), s.ruta); }),
          a.salteadosTotal > a.salteados.length ? h('div.ajuste-ayuda', 'Y ' + num(a.salteadosTotal - a.salteados.length) + ' más.') : null);
        var ver_ = h('button.btn.chico.fantasma', { onclick: function () { var abierto = lista.style.display !== 'none'; lista.style.display = abierto ? 'none' : 'block'; ver_.textContent = abierto ? 'Ver cuáles' : 'Ocultar'; } }, 'Ver cuáles');
        resultado.appendChild(h('div', { style: { marginTop: '10px' } }, h('span.ajuste-ayuda', 'No se importan: ' + por + '. '), ver_, lista));
      }
    }

    cargar();
  }


  function borrarTodo(alBorrar) {
    return App.confirmar('¿Borrar toda la memoria de la secretaría?', 'Se borran su diario, los temas en seguimiento y las fichas. No se puede deshacer, y la secretaría empieza de cero. Lo que ya compartiste con la oficina queda ahí.', 'Borrar la memoria', true).then(function (si) {
      if (!si) return;
      return api().del(base).then(function () { App.guardado('La memoria de la secretaría quedó vacía.'); if (alBorrar) alBorrar(); }).catch(App.fallo);
    });
  }

  /* ---------------- bloque para Ajustes › Secretaría ---------------- */
  /* `siempre`: mostrarlo aunque todavía no haya nada (con secretaría). Sin eso, solo si hay memoria guardada. */
  /* `compacto`: un renglón (Ajustes › Secretaría con secretaría): el resumen como bajada, «Ver» e «Importar notas…» en «⋯» */
  function bloque(siempre, compacto) {
    var caja = h('div'), estadoImp = h('div.ajuste-ayuda', { style: { marginTop: '6px' } });
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
        if (compacto) {
          caja.appendChild(App.seccion('Memoria', [App.renglon({ marca: h('div.renglon-marca', App.icono('libro')), titulo: 'Lo que fue sabiendo', sub: resumen,
            alTocar: function () { abrir({ alCerrar: cargar }); },
            control: [h('button.btn.chico', { onclick: function () { abrir({ alCerrar: cargar }); } }, 'Ver'),
              h('button.btn.chico.fantasma.icono', { title: 'Más opciones', onclick: function (ev) {
                App.menu(ev.currentTarget, [{ texto: 'Importar notas…', icono: 'abrir', accion: function () { importar(cargar); } }]);
              } }, App.icono('puntos'))] }), estadoImp]));
          return;
        }
        caja.appendChild(h('div.ajuste', { style: { display: 'block' } },
          h('div.ajuste-tit', 'Memoria'),
          h('div.ajuste-ayuda', { style: { margin: '2px 0 8px' } }, 'Lo que la secretaría va sabiendo de vos, de WhatsApp, Gmail, el calendario y lo que charlan: un diario, los temas en seguimiento y fichas de personas y cosas. Es privada: no la ven los demás agentes ni pasa por la Biblioteca.'),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
            h('button.btn', { onclick: function () { abrir({ alCerrar: cargar }); } }, App.icono('carpeta'), 'Ver la memoria'),
            h('button.btn', { onclick: function () { importar(cargar); } }, App.icono('abrir'), 'Importar notas…'),
            h('span.ajuste-ayuda', { style: { flex: 1 } }, resumen)),
          estadoImp));
      }).catch(function () {});
      api().get(base + imp).then(function (r) {
        var u = r.importacion;
        if (!u || (u.estado !== 'pendiente' && u.estado !== 'corriendo' && u.estado !== 'cortada')) return;
        estadoImp.textContent = u.estado === 'cortada' ? 'Hay una importación de notas cortada en la tanda ' + (u.tandasHechas + 1) + ' de ' + u.tandasTotal + ': abrí «Importar notas…» para seguirla.'
          : 'Importando notas: tanda ' + Math.min(u.tandasHechas + 1, u.tandasTotal) + ' de ' + u.tandasTotal + '.';
      }).catch(function () {});
    }
    cargar();
    return caja;
  }

  App.SecretariaMemoria = { abrir: abrir, bloque: bloque, importar: importar, ver: ver };
})();
