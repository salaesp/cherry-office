/* Biblioteca: archivos de la oficina (subidos o de carpetas vinculadas), su ficha y el conocimiento que generan.
   Todo se ordena por «de quién es»: toda la oficina o uno o más departamentos. La barra lateral elige qué departamento
   se ve, la etiqueta de cada fila cambia el dueño y «Subir» / «Vincular carpeta» van al departamento abierto. */
(function () {
  'use strict';
  var h = App.h, api = App.api;
  var relojEstado = null, estadoPrevio = null, estadoMemoria = null, memoriaCorriendo = false;
  var PROCESANDO = { pendiente: 'En cola', extrayendo: 'Leyendo el texto', fichando: 'Haciendo la ficha', leyendo: 'Los agentes lo están leyendo' };
  var OFICINA = 'compartido';

  /* estado de la cola: insignia en la barra lateral y aviso cuando termina algo */
  function vigilarEstado() {
    clearTimeout(relojEstado);
    /* lo que hay para decidir en la memoria (la insignia del menú «Memoria»); sin oficina abierta no se muestra */
    api.get('/api/memoria').then(function (m) {
      var antes = App.Memoria ? App.Memoria.contar(estadoMemoria) : 0;
      estadoMemoria = m;
      if (App.Memoria && App.Memoria.contar(m) !== antes) App.emit('memoria');
      /* el bibliotecario de la oficina pixel trabaja y avisa según esto; mientras ordena se mira más seguido */
      if (App.Oficina && App.Oficina.bibliotecario) App.Oficina.bibliotecario(m);
      memoriaCorriendo = !!m.corriendo;
    }).catch(function () {});
    api.get('/api/biblioteca/estado').then(function (st) {
      var b = App.dom && App.dom.navBib;
      if (b) {
        var trabajo = st.pendientes || (st.cola || []).length;
        b.className = 'insignia' + (trabajo ? ' aviso' : st.propuestas ? ' ok' : '') + (!trabajo && !st.propuestas ? ' oculto' : '');
        b.textContent = trabajo ? 'Procesando ' + trabajo : st.propuestas ? st.propuestas + (st.propuestas === 1 ? ' propuesta' : ' propuestas') : '';
      }
      var cambio = estadoPrevio && (estadoPrevio.pendientes !== st.pendientes || estadoPrevio.total !== st.total || estadoPrevio.propuestas !== st.propuestas);
      estadoPrevio = st;
      if (cambio) App.emit('biblioteca');
      relojEstado = setTimeout(vigilarEstado, st.pendientes || (st.cola || []).length ? 2500 : memoriaCorriendo ? 4000 : 15000);
    }).catch(function () { relojEstado = setTimeout(vigilarEstado, 20000); });
  }

  /* ---- dueños: «compartido» (toda la oficina) o ids de departamento ---- */
  function deptos() { return App.E.oficina.departamentos || []; }
  function nombreDueno(id) { if (id === OFICINA) return 'Toda la oficina'; var d = App.depto(id); return d ? d.nombre : 'un departamento que ya no está'; }
  function frase(ids) {
    var n = ids.map(nombreDueno);
    return n.length < 2 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1];
  }
  function marca(id) {
    if (id === OFICINA) return App.icono('personas');
    var d = App.depto(id);
    return h('span.biblio-punto', { style: { background: (d && d.color) || '#9a9a9a' } });
  }
  function agentesDe(id) {
    var ags = App.E.oficina.agentes || [];
    return id === OFICINA ? ags : ags.filter(function (a) { return a.departamento === id; });
  }
  /* departamentos de una carpeta vinculada, según su alcance */
  function duenosVinculo(v) {
    var al = v.alcance;
    if (!al || al === 'oficina') return [OFICINA];
    if (al.departamentos) return al.departamentos.slice();
    var ds = [];
    (al.agentes || []).forEach(function (id) { var a = App.agente(id); if (a && a.departamento && ds.indexOf(a.departamento) < 0) ds.push(a.departamento); });
    return ds.length ? ds : [OFICINA];
  }
  function duenosArchivo(f) { return f.departamentos && f.departamentos.length ? f.departamentos : [f.departamento || OFICINA]; }
  function nombreAgente(id) { return id ? App.humano.quien(id) : 'una reunión'; }
  function iniciales(n) { return String(n || '?').trim().slice(0, 2).toUpperCase(); }

  /* `slug` (opcional): abre con ese documento elegido (por ejemplo, recién guardado desde una entrega) */
  function abrir(slug) {
    if (App.Agente && App.Agente.alCerrar) App.Agente.alCerrar();
    var hj = App.hojaEnPanel({ titulo: 'Biblioteca', icono: 'libro', sinPie: true }, 'biblioteca');
    var vista = 'todo';            // 'todo' | 'compartido' | id de departamento | 'memoria' | 'propuestas'
    var sel = typeof slug === 'string' && slug ? { tipo: 'archivo', id: slug } : null;   // {tipo: 'archivo'|'carpeta', id}
    var abiertas = {};             // carpetas vinculadas desplegadas en la lista
    var archivos = [], vinculos = [];
    var buscar = h('input.campo', { placeholder: 'Buscar en todos los documentos…', style: { maxWidth: '320px' } });
    /* ⌘K deja la búsqueda en App.Biblioteca.busquedaPendiente antes de navegar acá */
    if (App.Biblioteca && App.Biblioteca.busquedaPendiente) { buscar.value = App.Biblioteca.busquedaPendiente; App.Biblioteca.busquedaPendiente = ''; }
    /* el buscador respeta lo que se está mirando: que el texto lo diga */
    function placeholderBuscar() {
      buscar.placeholder = App.depto(vista) ? 'Buscar en ' + nombreDueno(vista) + '…' : vista === OFICINA ? 'Buscar en lo de toda la oficina…' : 'Buscar en todos los documentos…';
    }
    var input = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: function () { subir(input.files); input.value = ''; } });
    var btnSubir = h('button.btn.primario', { onclick: function () { input.click(); } });
    var nav = h('div.biblio-nav'), lista = h('div.biblio-lista', App.cargando('Trayendo la biblioteca…')), det = h('div.biblio-det');
    var biblio = h('div.biblio', nav, lista, det);
    var zona = h('div', { style: { position: 'relative', flex: 1, minHeight: 0 } }, biblio);
    hj.cuerpo.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden';
    App.add(hj.cuerpo,
      h('div.biblio-barra', App.icono('buscar'), buscar, h('span', { style: { flex: 1 } }),
        h('button.btn', { onclick: vincular }, App.icono('enlace'), 'Vincular carpeta'), btnSubir, input),
      zona);

    /* a dónde va lo que se sube o se vincula: el departamento abierto, o toda la oficina */
    function destino() { return App.depto(vista) ? vista : OFICINA; }
    function textoDestino() { return destino() === OFICINA ? 'toda la oficina' : nombreDueno(destino()); }

    var cargar = App.debounce(function () {
      var q = buscar.value.trim();
      Promise.all([api.get('/api/archivos', { q: q }), api.get('/api/vinculos')]).then(function (rs) {
        archivos = rs[0].archivos || [];
        vinculos = rs[1].vinculos || [];
        pintar();
      }).catch(function (e) { App.vaciar(lista).appendChild(h('div.vacio', e.message)); });
    }, 150);
    buscar.addEventListener('input', function () { if (vista === 'propuestas' || vista === 'memoria') vista = 'todo'; cargar(); });

    function esDe(duenos, v) { return v === 'todo' || duenos.indexOf(v) >= 0; }
    function cuenta(v) {
      return archivos.filter(function (f) { return f.origen !== 'vinculo' && esDe(duenosArchivo(f), v); }).length
        + vinculos.filter(function (x) { return esDe(duenosVinculo(x), v); }).length;
    }

    function pintar() {
      placeholderBuscar();
      App.vaciar(btnSubir);
      App.add(btnSubir, App.icono('subir'), 'Subir a ' + textoDestino());
      pintarNav();
      biblio.classList.remove('sin-det');
      if (vista === 'propuestas') { cargarPropuestas(); return; }
      if (vista === 'memoria') { biblio.classList.remove('con-sel'); App.Memoria.pintar(lista, { det: det, biblio: biblio, alCambiar: function () { var n = App.Memoria.contar(estadoMemoria); vigilarEstado(); return n; } }); return; }
      det.style.display = '';
      pintarLista();
      pintarDetalle();
    }

    /* ---- barra lateral ---- */
    function itemNav(v, icono, texto, n) {
      return h('button.biblio-nav-item' + (vista === v ? '.activa' : ''), { onclick: function () { vista = v; sel = null; pintar(); } },
        icono, h('span.biblio-nav-txt', texto), n === null ? null : h('small', String(n)));
    }
    function pintarNav() {
      var np = estadoPrevio && estadoPrevio.propuestas;
      App.add(App.vaciar(nav),
        itemNav('todo', App.icono('capas'), 'Todo', cuenta('todo')),
        h('div.biblio-nav-tit', 'De quién es'),
        itemNav(OFICINA, App.icono('personas'), 'Toda la oficina', cuenta(OFICINA)),
        deptos().map(function (d) { return itemNav(d.id, marca(d.id), d.nombre, cuenta(d.id)); }),
        h('div.biblio-nav-sep'),
        itemNav('memoria', App.icono('libro'), 'Memoria', App.Memoria.contar(estadoMemoria) || null),
        itemNav('propuestas', App.icono('chispa'), 'Propuestas', np || null));
    }

    /* ---- lista ---- */
    function pintarLista() {
      App.vaciar(lista);
      var q = buscar.value.trim();
      if (App.depto(vista) || vista === OFICINA) {
        var gente = vista === OFICINA ? 'Material general: lo puede consultar cualquier agente' : agentesDe(vista).map(function (a) { return a.nombre; }).join(', ') || 'Todavía sin agentes';
        lista.appendChild(h('div.biblio-cab', marca(vista), h('b', nombreDueno(vista)), h('span', '· ' + gente)));
      }
      var filas = 0;
      vinculos.forEach(function (v) {
        if (!esDe(duenosVinculo(v), vista)) return;
        var suyos = archivos.filter(function (f) { return f.vinculo === v.id; });
        if (q && !suyos.length) return;
        filas++;
        lista.appendChild(filaCarpeta(v, suyos));
        if (abiertas[v.id] || q) suyos.forEach(function (f) { lista.appendChild(filaArchivo(f, true)); });
      });
      archivos.forEach(function (f) {
        if (f.origen === 'vinculo' || !esDe(duenosArchivo(f), vista)) return;
        filas++;
        lista.appendChild(filaArchivo(f, false));
      });
      if (!filas) {
        lista.appendChild(h('div.vacio', q ? 'No encontré nada con eso.' : h('div',
          h('p', vista === 'todo' ? 'Todavía no hay archivos.' : 'Todavía no hay documentos de ' + (vista === OFICINA ? 'toda la oficina' : nombreDueno(vista)) + '.'),
          h('p.ayuda', 'Arrastrá documentos acá o tocá «Subir a ' + textoDestino() + '». También podés cambiarle el dueño a uno que ya esté desde su etiqueta.'))));
      }
      biblio.classList.toggle('con-sel', !!sel);
    }

    function etiqueta(duenos, alCambiar, deCarpeta) {
      var txt = duenos[0] === OFICINA ? [marca(OFICINA), 'Oficina'] : duenos.length === 1 ? [marca(duenos[0]), nombreDueno(duenos[0])]
        : [h('span.biblio-puntos', duenos.map(marca)), duenos.slice(0, 2).map(nombreDueno).join(', ') + (duenos.length > 2 ? ' +' + (duenos.length - 2) : '')];
      var b = h('button.biblio-dueno', { title: (deCarpeta ? 'Acceso: ' : 'Es de ') + frase(duenos) + ' · cambiar', onclick: function (e) { e.stopPropagation(); menuDueno(b, duenos, alCambiar, deCarpeta); } },
        txt, App.icono('flecha'));
      return b;
    }

    /* menú «¿De quién es?»: toda la oficina, o uno o más departamentos (se aplica en cada clic) */
    function menuDueno(ancla, duenos, alCambiar, deCarpeta) {
      var actual = duenos.slice();
      var caja = h('div.biblio-menu');
      function opcion(id) {
        var on = actual.indexOf(id) >= 0;
        return h('button.menu-item', { onclick: function () {
          if (id === OFICINA) actual = [OFICINA];
          else {
            actual = actual.filter(function (x) { return x !== OFICINA; });
            var i = actual.indexOf(id);
            if (i >= 0) actual.splice(i, 1); else actual.push(id);
            if (!actual.length) actual = [OFICINA];
          }
          pintarMenu();
          alCambiar(actual.slice());
        } }, h('input', { type: 'checkbox', checked: on, tabindex: '-1', style: { pointerEvents: 'none', margin: 0 } }), marca(id), nombreDueno(id),
          id !== OFICINA ? h('small', String(agentesDe(id).length)) : null);
      }
      function pintarMenu() {
        App.add(App.vaciar(caja),
          h('div.menu-tit', deCarpeta ? '¿Quién puede abrirla? Podés marcar varios' : '¿De quién es? Podés marcar varios'),
          opcion(OFICINA), h('div.menu-sep'), deptos().map(function (d) { return opcion(d.id); }));
      }
      pintarMenu();
      App.emergente(ancla, caja);
    }

    function asignarArchivo(f, duenos) {
      return api.patch('/api/archivos/' + encodeURIComponent(f.slug), { departamentos: duenos }).then(function (r) {
        archivos = archivos.map(function (x) { return x.slug === f.slug ? Object.assign({}, x, r.archivo, { snippet: x.snippet }) : x; });
        pintar();
      }).catch(App.fallo);
    }
    function asignarCarpeta(v, duenos) {
      var alcance = duenos[0] === OFICINA ? 'oficina' : { departamentos: duenos };
      return api.patch('/api/vinculos/' + encodeURIComponent(v.id), { alcance: alcance }).then(function (r) {
        vinculos = vinculos.map(function (x) { return x.id === v.id ? r.vinculo : x; });
        pintar();
      }).catch(App.fallo);
    }

    function metaEstado(f) {
      if (f.estado === 'error') return h('span', { style: { color: 'var(--peligro)' }, title: f.error || '' }, 'No se pudo leer');
      if (f.estado !== 'listo') return h('span', { style: { color: 'var(--aviso)' } }, PROCESANDO[f.estado] || f.estado);
      return null;
    }
    function filaArchivo(f, dentroDeCarpeta) {
      var duenos = duenosArchivo(f);
      var otros = App.depto(vista) ? duenos.filter(function (x) { return x !== vista; }) : [];
      var meta = [metaEstado(f), otros.length ? 'también de ' + frase(otros) : null, f.entrega ? 'de ' + nombreAgente(f.entrega.agente) : null, f.nombre, App.fecha(f.actualizado)].filter(Boolean);
      var esSel = sel && sel.tipo === 'archivo' && sel.id === f.slug;
      return h('div.archivo' + (esSel ? '.sel' : '') + (dentroDeCarpeta ? '.en-carpeta' : ''), { onclick: function () { sel = { tipo: 'archivo', id: f.slug }; pintar(); } },
        h('div.tipo', (f.tipo || '').slice(0, 4)),
        h('div.archivo-txt', h('div.archivo-tit', f.titulo),
          h('div.archivo-meta', meta.map(function (m, i) { return [i ? ' · ' : null, m]; })),
          f.snippet ? h('div.archivo-snip', f.snippet.replace(/[\[\]]/g, '')) : null),
        dentroDeCarpeta ? null : etiqueta(duenos, function (d) { asignarArchivo(f, d); }));
    }
    function nombreCarpeta(v) { return String(v.ruta).split(/[\\/]/).filter(Boolean).pop() || v.ruta; }
    function filaCarpeta(v, suyos) {
      var esSel = sel && sel.tipo === 'carpeta' && sel.id === v.id;
      var meta = ['Carpeta vinculada', (v.archivos || 0) + (v.archivos === 1 ? ' archivo' : ' archivos'), v.pendientes ? v.pendientes + ' en proceso' : null, v.existe === false ? 'no se encuentra' : null].filter(Boolean).join(' · ');
      return h('div.archivo' + (esSel ? '.sel' : ''), { onclick: function () { sel = { tipo: 'carpeta', id: v.id }; abiertas[v.id] = true; pintar(); } },
        h('button.btn.fantasma.icono.chico.biblio-desplegar' + (abiertas[v.id] ? '.abierta' : ''), { title: abiertas[v.id] ? 'Ocultar archivos' : 'Ver archivos',
          onclick: function (e) { e.stopPropagation(); abiertas[v.id] = !abiertas[v.id]; pintar(); } }, App.icono('flecha')),
        h('div.tipo', App.icono('carpeta')),
        h('div.archivo-txt', h('div.archivo-tit', nombreCarpeta(v)), h('div.archivo-meta', meta)),
        etiqueta(duenosVinculo(v), function (d) { asignarCarpeta(v, d); }, true));
    }

    /* ---- detalle ---- */
    function pintarDetalle() {
      if (!sel) { App.vaciar(det).appendChild(h('div.vacio', 'Elegí un documento para ver de quién es y su ficha.')); return; }
      if (sel.tipo === 'carpeta') {
        var v = vinculos.filter(function (x) { return x.id === sel.id; })[0];
        if (!v) { sel = null; pintarDetalle(); return; }
        detalleCarpeta(v);
        return;
      }
      var slug = sel.id;
      api.get('/api/archivos/' + encodeURIComponent(slug)).then(function (r) {
        if (!sel || sel.id !== slug) return;
        detalleArchivo(r.archivo, r.texto);
      }).catch(function (e) { App.vaciar(det).appendChild(h('div.vacio', e.message)); });
    }

    function volver() { return h('button.btn.chico.fantasma.solo-angosto', { style: { marginBottom: '8px' }, onclick: function () { sel = null; pintar(); } }, App.icono('atras'), 'Volver'); }

    /* agentes de cada dueño: los que ya lo leyeron, en color; los que faltan, en gris */
    function gente(f, duenos) {
      var lect = f.lectura || {}, pend = f.leer || [];
      function av(a) {
        var leido = lect[a.id] === 'ok', leyendo = pend.indexOf(a.id) >= 0;
        return h('span.biblio-av' + (leido ? '.leido' : ''), { title: a.nombre + (leido ? ': lo leyó y tomó notas' : leyendo ? ': lo está leyendo' : ': todavía no lo leyó') }, iniciales(a.nombre));
      }
      if (duenos[0] === OFICINA) {
        var leyeron = Object.keys(lect).filter(function (id) { return lect[id] === 'ok'; }).map(App.agente).filter(Boolean);
        return h('div.biblio-gente', leyeron.length ? [h('div.biblio-gente-fila', leyeron.map(av)), h('div.ayuda', 'Lo leyeron y tomaron notas')] : h('div.ayuda', 'Lo puede consultar cualquier agente.'));
      }
      var todos = [];
      var filas = duenos.map(function (id) {
        var ags = agentesDe(id);
        todos = todos.concat(ags);
        return h('div.biblio-gente-fila', duenos.length > 1 ? h('span.biblio-gente-dep', nombreDueno(id)) : null,
          ags.length ? ags.map(av) : h('span.ayuda', 'sin agentes'));
      });
      var faltan = todos.filter(function (a) { return lect[a.id] !== 'ok'; });
      var txt = f.estado !== 'listo' && f.estado !== 'error' ? (f.estado === 'leyendo' ? 'Lo están leyendo ahora' : 'Lo leen cuando termine la ficha (si pedís que lo lean)')
        : !todos.length ? '' : !faltan.length ? 'Lo leyeron y tomaron notas' : faltan.length === todos.length ? 'Todavía no lo leyeron' : 'Falta ' + faltan.map(function (a) { return a.nombre; }).join(', ');
      return h('div.biblio-gente', filas, txt ? h('div.ayuda', txt) : null);
    }

    function tarjetaDueno(duenos, titulo, alCambiar, deCarpeta, extra) {
      var cambiar = h('button.btn.chico.fantasma', { onclick: function () { menuDueno(cambiar, duenos, alCambiar, deCarpeta); } }, 'Cambiar');
      return h('div.biblio-dueno-tarjeta',
        h('div.biblio-dueno-cab', h('span.biblio-puntos', duenos.map(marca)), h('b', titulo), cambiar),
        duenos.length > 1 ? h('div.chips-fila', duenos.map(function (id) { return h('span.chip.fijo', marca(id), nombreDueno(id)); })) : null,
        extra);
    }

    function detalleArchivo(f, texto) {
      var fi = f.ficha || {}, duenos = duenosArchivo(f), slug = f.slug, vinc = f.origen === 'vinculo';
      var v = vinc ? vinculos.filter(function (x) { return x.id === f.vinculo; })[0] : null;
      if (vinc && v) duenos = duenosVinculo(v);
      var titulo = duenos[0] === OFICINA ? 'Es de toda la oficina' : 'Es de ' + frase(duenos);
      var sugeridos = (fi.util_para || []).filter(function (d) { return App.depto(d) && duenos.indexOf(d) < 0; });
      var sugerencia = null;
      if (sugeridos.length && !vinc) {
        sugerencia = h('div.biblio-sugerencia', duenos[0] === OFICINA ? 'Le sirve sobre todo a:' : 'El bibliotecario cree que también le sirve a:',
          h('div.chips-fila', sugeridos.map(function (id) {
            return h('button.chip', { type: 'button', title: duenos[0] === OFICINA ? 'Asignárselo a ' + nombreDueno(id) : 'Sumar a ' + nombreDueno(id), onclick: function () {
              asignarArchivo(f, duenos[0] === OFICINA ? [id] : duenos.concat([id]));
            } }, App.icono('mas'), marca(id), nombreDueno(id));
          })));
      }
      var cambiar = vinc
        ? function () { if (v) asignarCarpeta(v, arguments[0]); }
        : function (d) { asignarArchivo(f, d); };
      function sec(t, c) { return c ? h('div.det-sec', h('h4', t), c) : null; }
      function ul(l) { return l && l.length ? h('ul', l.map(function (x) { return h('li', x); })) : null; }
      App.add(App.vaciar(det),
        volver(),
        h('h3', { style: { fontSize: '15px', marginBottom: '4px' } }, f.titulo),
        h('div.ayuda', { style: { marginBottom: f.entrega ? '6px' : '12px' } }, f.nombre + ' · ' + App.tam(f.tam || 0) + (v ? ' · en la carpeta «' + nombreCarpeta(v) + '»' : '')),
        f.entrega ? h('div.biblio-entrega', App.icono('bandeja'), h('span', 'Lo entregó ' + nombreAgente(f.entrega.agente) + '. Es una copia de cuando lo guardaste. ',
          App.Entregables ? h('a', { href: '#', onclick: function (e) { e.preventDefault(); hj.cerrar(); App.Entregables.abrir(f.entrega.id); } }, 'Ver la entrega') : null)) : null,
        tarjetaDueno(duenos, vinc ? 'Su carpeta es de ' + (duenos[0] === OFICINA ? 'toda la oficina' : frase(duenos)) : titulo, cambiar, vinc,
          [gente(f, duenos), sugerencia]),
        h('div', { style: { margin: '12px 0 14px' } }, App.acciones(!vinc ? [h('button.btn.chico.fantasma', { onclick: function () {
            App.confirmar('¿Quitar ' + f.nombre + '?', 'Va a la papelera de la oficina (no se borra) y sale del catálogo.', 'Quitar', true).then(function (si) {
              if (si) api.del('/api/archivos/' + encodeURIComponent(slug)).then(function () { sel = null; cargar(); }).catch(App.fallo);
            });
          } }, App.icono('papelera'), 'Quitar')] : null, [
          h('button.btn.chico', { onclick: function () { api.get('/api/archivos/' + encodeURIComponent(slug) + '/original').then(App.abrirContenido).catch(App.fallo); } }, App.icono('abrir'), 'Abrir'),
          f.estado === 'listo' ? h('button.btn.chico', { onclick: function () { api.post('/api/archivos/' + encodeURIComponent(slug) + '/leer', {}).then(function (r) { App.aviso('Lo van a leer ' + (r.agentes || []).map(function (id) { return App.humano.quien(id); }).join(', ') + '.'); vigilarEstado(); cargar(); }).catch(App.fallo); } }, 'Que lo lean') : null,
          f.estado === 'error' ? h('button.btn.chico', { onclick: function () { api.post('/api/archivos/' + encodeURIComponent(slug) + '/reprocesar', {}).then(function () { vigilarEstado(); cargar(); }).catch(App.fallo); } }, App.icono('recargar'), 'Reintentar') : null])),
        f.error ? h('div.error-txt', { style: { marginBottom: '12px' } }, f.error) : null,
        f.aviso ? h('div.ayuda', { style: { marginBottom: '12px' } }, f.aviso) : null,
        sec('Resumen', fi.resumen ? h('p', fi.resumen) : (f.estado !== 'listo' ? h('p.ayuda', PROCESANDO[f.estado] || 'Sin ficha todavía.') : null)),
        sec('Datos clave', ul(fi.datos_clave)),
        sec('Temas', fi.temas && fi.temas.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } }, fi.temas.map(function (t) { return h('span.insignia', t); })) : null),
        sec('Texto', texto ? h('div.texto-largo', texto) : null));
    }

    function detalleCarpeta(v) {
      var duenos = duenosVinculo(v), suyos = archivos.filter(function (f) { return f.vinculo === v.id; });
      var titulo = duenos[0] === OFICINA ? 'Es de toda la oficina' : 'Es de ' + frase(duenos);
      var quienes = duenos[0] === OFICINA ? 'Cualquier agente puede abrir los originales.'
        : (v.alcance && v.alcance.agentes ? 'Solo ' + v.alcance.agentes.map(App.humano.quien).join(', ') : 'Solo los agentes de ' + frase(duenos)) + ' pueden abrir los originales. Las fichas las puede consultar cualquiera.';
      App.add(App.vaciar(det),
        volver(),
        h('h3', { style: { fontSize: '15px', marginBottom: '4px' } }, nombreCarpeta(v)),
        h('div.ayuda', { style: { marginBottom: '12px', wordBreak: 'break-all' }, title: v.ruta }, App.humano.ruta(v.ruta).completa),
        tarjetaDueno(duenos, titulo, function (d) { asignarCarpeta(v, d); }, true, h('div.ayuda', { style: { marginTop: '8px' } }, quienes)),
        h('div', { style: { margin: '12px 0 14px' } }, App.acciones([h('button.btn.chico.fantasma', { onclick: function () {
            App.confirmar('¿Desvincular la carpeta?', 'La carpeta y sus archivos no se tocan; solo deja de estar en la biblioteca.', 'Desvincular', true).then(function (si) {
              if (si) api.del('/api/vinculos/' + encodeURIComponent(v.id)).then(function () { sel = null; cargar(); }).catch(App.fallo);
            });
          } }, App.icono('enlace'), 'Desvincular')], [
          h('button.btn.chico', { onclick: function () { escanear(v.id); } }, App.icono('recargar'), 'Actualizar')])),
        v.existe === false ? h('div.error-txt', { style: { marginBottom: '12px' } }, 'No encuentro la carpeta en esa ubicación.') : null,
        h('div.det-sec', h('h4', 'Archivos'), suyos.length
          ? h('div', suyos.map(function (f) { return h('button.archivo-fila', { onclick: function () { sel = { tipo: 'archivo', id: f.slug }; pintar(); } }, h('span', { style: { flex: 1 } }, f.titulo), metaEstado(f)); }))
          : h('p.ayuda', 'Todavía no hay archivos leídos de esta carpeta. Tocá «Actualizar».')));
    }

    function escanear(id) {
      return api.post('/api/vinculos/' + encodeURIComponent(id) + '/escanear', {}).then(function (r) {
        App.aviso(r && r.aviso ? r.aviso : 'Buscando cambios en la carpeta…');
        vigilarEstado(); cargar();
      }).catch(App.fallo);
    }

    /* ---- subir (arrastrar o botón): al departamento abierto ---- */
    function subir(files) {
      files = Array.prototype.slice.call(files || []);
      if (!files.length) return;
      var dep = destino(), a = textoDestino();
      var i = 0;
      App.aviso('Subiendo ' + files.length + (files.length === 1 ? ' archivo' : ' archivos') + ' a ' + a + '…');
      (function siguiente() {
        if (i >= files.length) { cargar(); vigilarEstado(); return; }
        var f = files[i++];
        var lector = new FileReader();
        lector.onload = function () {
          var b64 = String(lector.result).split(',')[1] || '';
          api.post('/api/archivos', { nombre: f.name, departamento: dep, base64: b64 })
            .then(function (r) { if (r.duplicado) App.aviso(f.name + ' ya estaba en ' + a + '.'); })
            .catch(function (e) { App.aviso(f.name + ': ' + e.message, true); })
            .then(siguiente);
        };
        lector.onerror = function () { App.aviso('No pude leer ' + f.name, true); siguiente(); };
        lector.readAsDataURL(f);
      })();
    }
    var capaSoltar = null;
    zona.addEventListener('dragover', function (e) { e.preventDefault(); if (!capaSoltar) { capaSoltar = h('div.soltar', 'Soltá para subir a ' + textoDestino()); zona.appendChild(capaSoltar); } });
    zona.addEventListener('dragleave', function (e) { if (capaSoltar && !zona.contains(e.relatedTarget)) { capaSoltar.remove(); capaSoltar = null; } });
    zona.addEventListener('drop', function (e) { e.preventDefault(); if (capaSoltar) { capaSoltar.remove(); capaSoltar = null; } subir(e.dataTransfer.files); });

    /* ---- vincular una carpeta: queda del departamento abierto ---- */
    function vincular() {
      App.elegirCarpeta('Elegí la carpeta a vincular').then(function (ruta) {
        if (!ruta) return;
        var dep = destino();
        api.post('/api/vinculos', { ruta: ruta, alcance: dep === OFICINA ? 'oficina' : { departamentos: [dep] } }).then(function (r) {
          App.aviso('Carpeta vinculada a ' + textoDestino() + '. Se van a leer sus archivos.');
          sel = { tipo: 'carpeta', id: r.vinculo.id };
          abiertas[r.vinculo.id] = true;
          escanear(r.vinculo.id);
        }).catch(App.fallo);
      });
    }

    /* ---- propuestas de cambio al conocimiento ---- */
    function cargarPropuestas() {
      det.style.display = 'none'; biblio.classList.remove('con-sel');
      App.vaciar(lista).appendChild(App.cargando('Trayendo las propuestas…'));
      api.get('/api/biblioteca/propuestas').then(function (r) {
        App.vaciar(lista);
        lista.appendChild(h('p.ayuda', { style: { padding: '12px 18px 8px' } }, 'Cuando un documento contradice lo que la oficina tiene anotado, el bibliotecario propone un cambio. Nada se modifica sin tu OK.'));
        if (!r.propuestas.length) lista.appendChild(h('div.vacio', 'No hay propuestas pendientes.'));
        r.propuestas.forEach(function (p) {
          var doc = p.archivo ? archivos.filter(function (f) { return f.slug === p.archivo; })[0] : null;
          lista.appendChild(h('div.propuesta', h('b', p.titulo || 'Propuesta'),
            p.archivo ? h('div.propuesta-origen', App.icono('libro'), h('span', 'Sale de ', h('b', doc ? doc.titulo : App.humano.ruta(p.archivo).corta)),
              h('button.btn.chico.fantasma', { onclick: function () { vista = 'todo'; sel = { tipo: 'archivo', id: p.archivo }; pintar(); } }, 'Ver el documento')) : null,
            p.sugerencia ? h('p.ayuda', p.sugerencia) : null,
            h('div.difs', h('div', h('div.ayuda', 'Hoy dice'), p.actual || '—'), h('div', h('div.ayuda', 'Propuesta'), p.nuevo || '—')),
            App.acciones(null, [
              h('button.btn.chico.fantasma', { onclick: function () { resolver(p.id, false); } }, 'Rechazar'),
              h('button.btn.chico.primario', { onclick: function () { resolver(p.id, true); } }, 'Aceptar')])));
        });
      }).catch(function (e) { App.vaciar(lista).appendChild(h('div.vacio', e.message)); });
    }
    function resolver(id, ok) {
      api.post('/api/biblioteca/propuestas/' + encodeURIComponent(id), { aceptar: ok }).then(function () { App.aviso(ok ? 'Cambio aplicado.' : 'Propuesta descartada.'); vigilarEstado(); pintar(); }).catch(App.fallo);
    }

    var alCambiar = function () { if (document.body.contains(hj.el)) cargar(); };
    App.on('biblioteca', alCambiar);
    App.on('memoria', function () { if (document.body.contains(hj.el)) pintarNav(); });
    cargar();
  }

  App.Biblioteca = { abrir: abrir, vigilarEstado: vigilarEstado, busquedaPendiente: '' };
})();
