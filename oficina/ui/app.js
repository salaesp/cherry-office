/* Arranque, pantalla de inicio (sin oficina), estructura principal y barra lateral. */
(function () {
  'use strict';
  var h = App.h, api = App.api;
  var E = App.E;
  var raiz = document.getElementById('raiz');
  var dom = {};

  /* ---------------- arranque ---------------- */
  function arrancar() {
    api.get('/api/estado').then(function (st) {
      E.estado = st;
      // primera vez que se abre la app: elegir cómo piden permiso los agentes (se ve encima de lo que se monte)
      if (st.modo_permisos === null && !arrancar.modoPreguntado) { arrancar.modoPreguntado = true; App.Permisos.elegirModo(null, true); }
      if (st.oficina) return api.get('/api/oficina').then(function (r) { montar(r.carpeta, r.oficina); });
      inicio();
    }).catch(function (e) {
      App.vaciar(raiz).appendChild(h('div.inicio', h('div', { style: { textAlign: 'center' } },
        h('h1', 'No me puedo conectar con la oficina'), h('p.bajada', e.message), h('button.btn', { onclick: arrancar }, 'Reintentar'))));
    });
  }

  /* ---------------- inicio ---------------- */
  /* Las mismas cuatro opciones, con los mismos textos e íconos, en la pantalla de inicio, en el menú de la oficina y en ⌘K. */
  function opcionesOficina() {
    return [
      { icono: 'edificio', texto: 'Crear una oficina', bajada: 'Ponele nombre y elegí los departamentos.', accion: crearOficina },
      { icono: 'chispa', texto: 'Armar una oficina charlando', bajada: 'Tu secretaría te pregunta cómo trabajás y te propone departamentos, agentes y flujos.', accion: armarCharlando },
      { icono: 'carpeta', texto: 'Abrir una oficina existente', bajada: 'Buscá la carpeta de una oficina que ya tengas.', accion: abrirExistente },
      { icono: 'importar', texto: 'Importar una oficina', bajada: 'Abrí un archivo .zip que alguien exportó desde Oficina.', accion: importarOficina },
    ];
  }

  function inicio() {
    App.Oficina.finReunion && E.oficina && App.Oficina.finReunion();
    E.oficina = null; E.carpeta = null;
    var recientes = h('div.recientes');
    var foto = h('div.inicio-foto', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr' } });
    ['ana', 'tomi', 'sol', 'leo'].forEach(function (s) { foto.appendChild(App.retratoImg({ id: s, avatar: { semilla: s } }, 'x', 320)); });
    foto.querySelectorAll('img').forEach(function (i) { i.style.cssText = 'width:100%;height:100%;object-fit:cover;background:var(--fondo)'; });
    App.vaciar(raiz).appendChild(h('div.inicio', h('div.inicio-caja', foto, h('div',
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' } }, App.logo(), h('b', 'Oficina')),
      h('h1', 'Armá tu oficina'),
      h('p.bajada', 'Un equipo de agentes de Claude que trabaja para vos: los contratás contándoles qué necesitás, les hablás y los juntás a debatir.'),
      E.estado && !E.estado.claude ? h('p.error-txt', { style: { marginBottom: '14px' } }, 'No encontré Claude Code en esta compu. Vas a poder armar la oficina, pero los agentes no van a responder hasta instalarlo.') : null,
      recientes,
      opcionesOficina().map(function (o) {
        return h('button.opcion', { onclick: o.accion }, App.icono(o.icono), h('div', h('b', o.texto), h('span', o.bajada)));
      })
    ))));
    api.get('/api/oficinas').then(function (r) {
      if (!r.oficinas || !r.oficinas.length) return;
      recientes.appendChild(h('div.etiqueta-campo', 'Recientes'));
      r.oficinas.forEach(function (o) {
        recientes.appendChild(h('div.reciente', { title: o.carpeta, onclick: function () { abrirCarpeta(o.carpeta); } },
          App.icono('edificio'), h('div', { style: { minWidth: 0 } }, h('div', o.nombre), h('div.ruta', { title: o.carpeta }, App.humano.ruta(o.carpeta).completa))));
      });
      recientes.appendChild(h('div.etiqueta-campo', { style: { marginTop: '14px' } }, 'O empezá otra'));
    }).catch(function () {});
  }

  /* Campos comunes a «Crear una oficina» y «Armar una oficina charlando»: nombre, tu nombre, tu secretaría y dónde se
     guarda. Toda oficina nueva viene con secretaría: es a quien le pedís crear cosas (docs/plan-secretaria-creadora.md). */
  function camposOficina() {
    var nombre = h('input.campo', { placeholder: 'Ej.: Estudio Cherry', maxlength: 80, autofocus: true });
    var duenio = h('input.campo', { placeholder: 'Cómo te llaman los agentes', maxlength: 80, value: App.Yo.nombre() });
    var sec = h('input.campo', { placeholder: 'Por ejemplo, Sofía o Alex', maxlength: 60 });
    var carpeta = null, dondeTxt = h('span', { style: { color: 'var(--suave)' } });
    function pintarDonde() { dondeTxt.textContent = carpeta || ('Oficinas / ' + (nombre.value.trim() || '…') + ' (en tu carpeta de usuario)'); }
    nombre.addEventListener('input', pintarDonde);
    pintarDonde();
    return {
      nombre: nombre, duenio: duenio,
      secretaria: function () { return { nombre: sec.value.trim() }; },
      campoSecretaria: h('div.fila-campo', h('label.etiqueta-campo', 'Tu secretaría'), sec,
        h('div.ayuda', 'Es a quien le pedís lo que necesites: contratar a alguien, armar un flujo, programar una tarea. Te propone y vos aprobás. Si no le ponés nombre, se llama «Secretaría».')),
      carpeta: function () { return carpeta || undefined; },
      cabecera: h('div.dos', h('div.fila-campo', h('label.etiqueta-campo', 'Nombre de la oficina'), nombre), h('div.fila-campo', h('label.etiqueta-campo', 'Tu nombre'), duenio)),
      donde: h('div.fila-campo', h('label.etiqueta-campo', 'Dónde se guarda'), h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, App.icono('carpeta'), dondeTxt,
        h('button.btn.chico', { style: { marginLeft: 'auto' }, onclick: function () { App.elegirCarpeta('Elegí dónde crear la oficina', { crear: true }).then(function (r) { if (r) { carpeta = r.replace(/\/$/, '') + '/' + (nombre.value.trim() || 'Oficina'); pintarDonde(); } }); } }, 'Cambiar…')),
        h('div.ayuda', 'Es una carpeta común: ahí quedan los agentes, su conocimiento, las actas y los archivos.')),
    };
  }

  /* Monta la oficina recién creada (o abierta), cerrando lo que hubiera abierto de la anterior. */
  function montarNueva(r) {
    if (E.oficina && App.Agente) App.Agente.cerrar();
    montar(r.carpeta, r.oficina);
  }

  /* Abre la charla con la secretaría de la oficina recién creada (o avisa si no se pudo contratar). */
  function hablarConSecretaria(r) {
    var sec = r.oficina && r.oficina.secretaria;
    if (sec && sec.agente && App.agente(sec.agente)) { App.Agente.abrir(sec.agente); return true; }
    App.aviso('No pude contratar la secretaría: contratala en Ajustes › Secretaría.', true);
    return false;
  }

  /* La oficina arranca sin departamentos y se abre la charla con la secretaría para armarla. */
  function armarCharlando() {
    var hj = App.hoja({ titulo: 'Armar una oficina charlando', ancho: 560 });
    var c = camposOficina(), err = h('div.error-txt');
    hj.cuerpo.appendChild(h('div', c.cabecera, c.campoSecretaria,
      h('div.fila-campo', h('label.etiqueta-campo', 'Cómo sigue'), h('div.ayuda', 'Se abre la charla con tu secretaría: le contás cómo trabajás, de a poco o pegando un texto, y te propone departamentos, agentes y flujos. No se crea nada hasta que lo apruebes.')),
      c.donde, err));
    var btn = h('button.btn.primario', { onclick: enviar }, 'Empezar a charlar');
    App.add(hj.pie, h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), btn);
    function enviar() {
      err.textContent = '';
      if (!c.nombre.value.trim()) { err.textContent = 'Ponele un nombre a la oficina.'; c.nombre.focus(); return; }
      btn.disabled = true; btn.textContent = 'Creando…';
      api.post('/api/oficinas', { nombre: c.nombre.value.trim(), duenio: c.duenio.value.trim(), vacia: true, carpeta: c.carpeta(), secretaria: c.secretaria() })
        .then(function (r) { hj.cerrar(); montarNueva(r); if (!hablarConSecretaria(r)) App.Creador.abrir(); })
        .catch(function (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Empezar a charlar'; });
    }
  }

  var SUGERIDOS = [['Dirección', '#26262b'], ['Marketing', '#e6c22e'], ['Ventas', '#3c6fb4'], ['Operaciones', '#2a9d8f'], ['Finanzas', '#4b7f52'], ['Producto', '#8e78c4'], ['Diseño', '#e58aa6'], ['Atención al cliente', '#e0644f']];
  App.PALETA = ['#c4372f', '#e0644f', '#e6a23c', '#e6c22e', '#4b7f52', '#2a9d8f', '#5aa9d6', '#3c6fb4', '#8e78c4', '#e58aa6', '#8a6a4f', '#6b7078'];

  function crearOficina() {
    var hj = App.hoja({ titulo: 'Crear una oficina', ancho: 560 });
    var deps = [['Marketing', '#e6c22e'], ['Ventas', '#3c6fb4'], ['Operaciones', '#2a9d8f']];
    var c = camposOficina();
    var lista = h('div.lista-ed'), sug = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } });
    var err = h('div.error-txt');
    function pintar() {
      App.vaciar(lista); App.vaciar(sug);
      deps.forEach(function (d, i) {
        var muestra = h('button.muestra', { style: { background: d[1] }, title: 'Color', onclick: function () { elegirColor(muestra, d[1], function (col) { d[1] = col; pintar(); }); } });
        var inp = h('input.campo', { value: d[0], maxlength: 60, oninput: function () { d[0] = inp.value; } });
        lista.appendChild(h('div.fila-ed', muestra, inp, h('button.btn.fantasma.icono', { title: 'Quitar', onclick: function () { deps.splice(i, 1); pintar(); } }, App.icono('cerrar'))));
      });
      SUGERIDOS.filter(function (s) { return !deps.some(function (d) { return d[0].toLowerCase() === s[0].toLowerCase(); }); }).forEach(function (s) {
        sug.appendChild(h('button.chip', { onclick: function () { if (deps.length < 12) { deps.push(s.slice()); pintar(); } } }, App.icono('mas'), s[0]));
      });
      sug.appendChild(h('button.chip', { onclick: function () { if (deps.length < 12) { deps.push(['Nuevo departamento', App.PALETA[deps.length % App.PALETA.length]]); pintar(); var u = lista.querySelectorAll('input'); u[u.length - 1].select(); } } }, App.icono('mas'), 'Otro'));
    }
    pintar();
    hj.cuerpo.appendChild(h('div', c.cabecera,
      h('div.fila-campo', h('label.etiqueta-campo', 'Departamentos'), lista, sug, h('div.ayuda', 'Cada departamento es una sala del edificio. Podés cambiarlos después.')),
      c.campoSecretaria, c.donde, err));
    var btn = h('button.btn.primario', { onclick: enviar }, 'Crear oficina');
    App.add(hj.pie, h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), btn);
    function enviar() {
      err.textContent = '';
      if (!c.nombre.value.trim()) { err.textContent = 'Ponele un nombre a la oficina.'; c.nombre.focus(); return; }
      var lis = deps.filter(function (d) { return d[0].trim(); }).map(function (d) { return { nombre: d[0].trim(), color: d[1] }; });
      if (!lis.length) { err.textContent = 'Agregá al menos un departamento.'; return; }
      btn.disabled = true; btn.textContent = 'Creando…';
      api.post('/api/oficinas', { nombre: c.nombre.value.trim(), duenio: c.duenio.value.trim(), departamentos: lis, carpeta: c.carpeta(), secretaria: c.secretaria() })
        .then(function (r) {
          hj.cerrar(); montarNueva(r);
          var a = App.secretaria();
          App.aviso(a ? 'Oficina creada. Para sumar gente, armar flujos o programar tareas, pedíselo a ' + a.nombre + '.' : 'Oficina creada. Ya podés contratar a tu primer agente.');
          if (a) App.Agente.abrir(a.id);
        })
        .catch(function (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Crear oficina'; });
    }
  }

  function abrirExistente() {
    App.elegirCarpeta('Elegí la carpeta de la oficina', { oficinas: true }).then(function (r) { if (r) abrirCarpeta(r); });
  }
  function abrirCarpeta(c) {
    api.post('/api/oficinas/abrir', { carpeta: c }).then(function (r) { montar(r.carpeta, r.oficina); }).catch(App.fallo);
  }
  /* ---------------- exportar e importar ---------------- */
  /* Borra la oficina abierta: sus chats, reuniones, tareas y el historial del Creador. En la app la carpeta va a la
     papelera (se puede recuperar); en el navegador queda donde está. Después vuelve a la pantalla de inicio. */
  function borrarOficina() {
    var carpeta = E.carpeta, nombre = E.oficina.nombre;
    App.confirmar('¿Borrar «' + nombre + '»?', 'Se borran sus conversaciones, reuniones, tareas y lo que charlaste con el Creador. Su carpeta (' + carpeta + ') se borra del disco de forma permanente: no se puede deshacer.', 'Borrar oficina', true).then(function (si) {
      if (!si) return;
      var p = App.nativo.hay ? App.nativo.borrarOficina(carpeta) : api.del('/api/oficina');
      p.then(function (r) {
        if (r && r.error) throw new Error(r.error);
        App.Agente.cerrar();
        location.reload();
      }).catch(App.fallo);
    });
  }

  function exportarOficina() {
    var hj = App.hoja({ titulo: 'Exportar oficina', ancho: 520 });
    var destino = null, dondeTxt = h('span', { style: { color: 'var(--suave)', overflow: 'hidden', textOverflow: 'ellipsis' } }, 'Descargas');
    var err = h('div.error-txt');
    function item(si, texto) { return h('li', { style: { color: si ? 'var(--texto)' : 'var(--suave)' } }, (si ? '✓ ' : '✕ ') + texto); }
    App.add(hj.cuerpo,
      h('p', { style: { marginTop: 0 } }, 'Arma un archivo .zip con «' + E.oficina.nombre + '» para compartirla o pasarla a otra compu. Quien lo reciba la abre con «Importar una oficina».'),
      h('ul', { style: { listStyle: 'none', padding: 0, margin: '0 0 14px', display: 'grid', gap: '4px', fontSize: '13px' } },
        item(true, 'Departamentos, agentes y tareas programadas'),
        item(true, 'Memoria de la oficina, decisiones y notas de cada agente'),
        item(true, 'Actas de reunión, documentos de la biblioteca (con sus fichas) y entregables'),
        item(false, 'Conversaciones, entregas por revisar y costos (quedan en esta compu)'),
        item(false, 'Carpetas vinculadas y la papelera')),
      h('div.fila-campo', h('label.etiqueta-campo', 'Dónde guardarlo'), h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, App.icono('carpeta'), dondeTxt,
        h('button.btn.chico', { style: { marginLeft: 'auto' }, onclick: function () { App.elegirCarpeta('Elegí dónde guardar el .zip', { crear: true }).then(function (r) { if (r) { destino = r; dondeTxt.textContent = r; } }); } }, 'Cambiar…'))),
      h('div.ayuda', 'Lleva todo lo que sabe la oficina: revisá que quieras compartirlo.'),
      err);
    var btn = h('button.btn.primario', { onclick: enviar }, 'Exportar');
    App.add(hj.pie, h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), btn);
    function enviar() {
      err.textContent = ''; btn.disabled = true; btn.textContent = 'Exportando…';
      api.post('/api/oficina/exportar', { destino: destino || undefined }).then(function (r) {
        hj.cerrar(); listoExportar(r);
      }).catch(function (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Exportar'; });
    }
  }

  function listoExportar(r) {
    var hj = App.hoja({ titulo: 'Oficina exportada', ancho: 520 });
    var detalle = App.tam(r.tam || 0) + ' · ' + (r.documentos === 1 ? '1 documento' : (r.documentos || 0) + ' documentos');
    var omitidos = [];
    if (r.omitidos && r.omitidos.vinculos) omitidos.push(r.omitidos.vinculos === 1 ? 'No incluye la carpeta vinculada.' : 'No incluye las ' + r.omitidos.vinculos + ' carpetas vinculadas.');
    if (r.omitidos && r.omitidos.papelera) omitidos.push('No incluye la papelera de la biblioteca.');
    App.add(hj.cuerpo,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, App.icono('importar'), h('div', { style: { minWidth: 0 } }, h('b', r.nombre), h('div', { style: { color: 'var(--tenue)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: r.archivo }, r.archivo), h('div.ayuda', detalle))),
      omitidos.length ? h('div.ayuda', { style: { marginTop: '10px' } }, omitidos.join(' ')) : null,
      avisosLista(r.avisos));
    if (App.nativo.hay) App.add(hj.pie, h('button.btn', { onclick: function () { App.nativo.revelar(r.archivo); } }, 'Mostrar ' + App.nativo.enExplorador));
    App.add(hj.pie, h('button.btn.primario', { onclick: hj.cerrar }, 'Listo'));
  }

  function avisosLista(avisos) {
    if (!avisos || !avisos.length) return null;
    return h('div', { style: { marginTop: '12px' } }, h('div.etiqueta-campo', 'Para revisar'),
      h('ul', { style: { margin: 0, paddingLeft: '18px', display: 'grid', gap: '4px', fontSize: '13px' } }, avisos.map(function (a) { return h('li', a); })));
  }

  function importarOficina() {
    App.elegirZip('Elegí el .zip de la oficina').then(function (archivo) {
      if (!archivo) return;
      /* un aviso que se queda hasta que termina (App.aviso se apaga solo a los segundos) */
      var espera = h('div.tostadas', h('div.tostada', h('span.giro'), h('span', ' Importando la oficina… puede tardar un poco.')));
      document.body.appendChild(espera);
      api.post('/api/oficinas/importar', { archivo: archivo }).then(function (r) {
        espera.remove();
        App.Agente && App.Agente.cerrar && E.oficina && App.Agente.cerrar();
        montar(r.carpeta, r.oficina);
        if (r.avisos && r.avisos.length) {
          var hj = App.hoja({ titulo: 'Oficina importada', ancho: 520 });
          App.add(hj.cuerpo, h('p', { style: { marginTop: 0 } }, '«' + r.oficina.nombre + '» quedó en ' + r.carpeta + '.'), avisosLista(r.avisos));
          App.add(hj.pie, h('button.btn.primario', { onclick: hj.cerrar }, 'Listo'));
        } else {
          App.aviso('Oficina importada: «' + r.oficina.nombre + '».');
        }
      }).catch(function (e) { espera.remove(); App.fallo(e); });
    });
  }
  App.exportarOficina = exportarOficina;
  App.importarOficina = importarOficina;

  App.abrirCarpetaOficina = abrirCarpeta;
  App.crearOficina = crearOficina;
  App.armarCharlando = armarCharlando;
  App.opcionesOficina = opcionesOficina;
  App.abrirExistente = abrirExistente;
  App.editarOficina = editarOficina;
  App.borrarOficina = function () { borrarOficina(); };
  App.otraOficina = function () { otraOficina(); };
  App.menuOficina = function (ancla) { menuOficina(ancla); };

  /* ---------------- selector de color ---------------- */
  function elegirColor(ancla, actual, alElegir) {
    var e = App.emergente(ancla, h('div',
      h('div.paleta', App.PALETA.map(function (c) { return h('button', { class: c.toLowerCase() === (actual || '').toLowerCase() ? 'sel' : '', style: { background: c }, title: c, onclick: function () { e.cerrar(); alElegir(c); } }); })),
      h('div', { style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--suave)' } }, 'Otro:',
        h('input', { type: 'color', value: actual || '#888888', onchange: function (ev) { e.cerrar(); alElegir(ev.target.value); } }))));
  }
  App.elegirColor = elegirColor;

  /* ---------------- estructura principal ---------------- */
  App.atajoMod = /Mac/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';

  /* ---------------- la secretaría: a quien se le pide crear cosas (docs/plan-secretaria-creadora.md) ---------------- */
  App.secretaria = function () {
    var sec = App.E && App.E.oficina && App.E.oficina.secretaria;
    return sec && sec.agente && App.agente ? App.agente(sec.agente) || null : null;
  };
  /* abre la charla con ella; sin secretaría (oficinas de antes), la pantalla de armar la oficina con el Creador */
  App.pedirleASecretaria = function () {
    var a = App.secretaria();
    if (a) App.Agente.abrir(a.id); else App.Nav.ir('#/equipo/creador');
  };
  /* la línea «¿Preferís pedírselo a Sofía?» arriba de lo que se crea a mano (contratar, departamento, tarea) */
  App.pistaSecretaria = function (que, alIr) {
    var a = App.secretaria();
    if (!a) return null;
    return h('div.pista-sec', App.retratoImg(a, 'pista-sec-cara', 48),
      h('span', '¿Preferís pedírselo a ' + a.nombre + '? ' + que + ' '),
      h('button.enlace', { type: 'button', onclick: function () { if (alIr) alIr(); App.pedirleASecretaria(); } }, 'Hablarle a ' + a.nombre));
  };

  /* «+»: todo lo que empieza algo nuevo, en un solo botón (arriba del riel) */
  function menuNuevo(ancla) {
    /* en el celular, solo empezar algo: charlar, programar una tarea o correr un flujo (armar la oficina es cosa de la compu) */
    if (App.movil) {
      App.menu(ancla, [
        { texto: 'Charlar con alguien…', icono: 'charla', accion: function () { App.Nav.elegirAgente(ancla, function (id) { App.Agente.nueva(id); }, 'Charlar con'); } },
        { texto: 'Nueva tarea…', icono: 'reloj', accion: function () { App.Agente.nuevaTarea(null, {}); } },
        { texto: 'Correr un flujo…', icono: 'flujo', accion: function () { App.Nav.ir('#/trabajo/flujos'); App.Flujos.nueva(); } }]);
      return;
    }
    App.menu(ancla, [
      { texto: 'Charlar con alguien…', icono: 'charla', accion: function () { App.Nav.elegirAgente(ancla, function (id) { App.Agente.nueva(id); }, 'Charlar con'); } },
      { texto: 'Llamar a reunión…', icono: 'reunion', accion: function () { App.Reunion.nueva(); } },
      { texto: 'Nueva tarea…', icono: 'reloj', accion: function () { App.Agente.nuevaTarea(null, {}); } },
      { texto: 'Nueva corrida de flujo…', icono: 'flujo', accion: function () { App.Flujos.abrir(); App.Flujos.nueva(); } },
      '-',
      { texto: App.secretaria() ? 'Pedírselo a ' + App.secretaria().nombre + '…' : 'Armar con el Creador…', icono: 'chispa', accion: function () { App.pedirleASecretaria(); } },
      { texto: 'Contratar un agente…', icono: 'personas', accion: function () { App.Nav.ir('#/equipo/contratar'); } },
      { texto: 'Nuevo departamento…', icono: 'capas', accion: function () { App.Departamentos.agregar(); } },
    ]);
  }

  /* Estructura: riel (secciones) · lista de la sección · vista. La vista tiene la maqueta y el panel (dom.derecho) donde
     pintan los módulos: en «Oficina» el panel flota sobre la maqueta; en las demás secciones va pegado a la lista y la
     oficina sigue a la vista a la derecha (nav.js). */
  function montar(carpeta, oficina) {
    E.carpeta = carpeta; E.oficina = oficina;
    document.title = oficina.nombre;
    var primera = !dom.app || !document.body.contains(dom.app);
    if (primera) {
      dom.equipo = h('div.equipo');
      dom.nombre = h('div.marca-nombre'); dom.sub = h('div.marca-sub');
      /* el nombre de la oficina sobre la maqueta es un rótulo: para cambiar de oficina está el logo del riel */
      dom.marca = h('div.marca.rotulo', h('div.marca-txt', dom.nombre, dom.sub));
      dom.navReu = h('span.insignia.ok.oculto', 'En curso');
      dom.navBib = h('span.insignia.oculto');
      dom.navEnt = h('span.insignia.aviso.oculto');
      dom.navParte = h('span.insignia.oculto');
      dom.navTar = h('span.insignia.oculto');
      dom.navFlu = h('span.insignia.info.oculto');
      dom.navCon = h('span.insignia.oculto');
      dom.lienzo = h('div.lienzo');
      dom.carga = h('div.carga-oficina', h('span.giro'), 'Armando la oficina…');
      dom.avisoReu = h('div.aviso-reunion.oculto');
      dom.derecho = h('aside.derecho');
      dom.lista = h('aside.lista-col');
      /* la ventana que abre el riel: la lista de la sección y el panel, juntos y sobre la oficina. En la compu la cruza
         una barra fina (sección › lo abierto) con la única ×, arriba a la derecha de todo: cierra la ventana entera. */
      dom.ruta = h('div.ventana-ruta');
      dom.barra = h('div.ventana-barra', dom.ruta,
        h('button.btn.fantasma.icono.ventana-cerrar', { title: 'Cerrar', onclick: cerrarDesdeBarra }, App.icono('cerrar')));
      dom.ventana = h('div.ventana', dom.barra, dom.lista, dom.derecho);
      moverVentana(dom.ventana, dom.barra);
      var rutaPend = false, refrescarRuta = function () {
        if (rutaPend) return;
        rutaPend = true;
        requestAnimationFrame(function () { rutaPend = false; pintarRuta(); });
      };
      new MutationObserver(refrescarRuta).observe(dom.lista, { childList: true, subtree: true, characterData: true });
      new MutationObserver(refrescarRuta).observe(dom.derecho, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-modo'] });
      var riel = App.Nav.riel({
        menuOficina: menuOficina, menuNuevo: menuNuevo,
        insignias: { bandeja: dom.navEnt, equipo: dom.navReu, trabajo: dom.navTar },
        extra: [
          App.Uso ? App.Uso.boton() : null,
          h('button.riel-item.riel-extra', { title: 'Buscar o ir a… (' + App.atajoMod + 'K)', onclick: function () { App.Paleta.abrir(); } }, App.icono('buscar'), h('span', App.atajoMod + 'K')),
          h('button.riel-item.riel-extra', { title: 'Ajustes (' + App.atajoMod + ',)', onclick: function () { App.Ajustes.abrir(); } }, App.icono('ajustes'), h('span', 'Ajustes'))
        ]
      });
      dom.app = h('div.app.en-oficina', riel,
        /* llamar a reunión: en Equipo › Reuniones y en el «+» del riel (ya no flota un botón sobre la oficina) */
        h('main.vista', dom.lienzo, dom.carga, dom.avisoReu, dom.marca,
          h('div.pista', App.Paleta ? App.Paleta.BASE : 'Rueda o pellizco para acercarte · arrastrá para moverte'),
          dom.ventana));
      App.vaciar(raiz).appendChild(dom.app);
      App.dom = dom;
      if (App.Microfono) App.Microfono.montar(dom.app);
      App.Oficina.iniciar(dom.lienzo);
      App.Oficina.alElegirAgente(function (id) { App.Agente.abrir(id); });
      App.Oficina.alElegirLugar(function (t, id) {
        if (t === 'reunion') App.Reunion.abrir();
        else if (t === 'biblioteca') App.Biblioteca.abrir();
        else if (t === 'entregables' || t === 'direccion') App.Entregables.abrir();
        else if (t === 'yo') App.Yo.abrir();
        else if (t === 'entrega') App.Entregables.abrir(id);
        else if (t === 'creador') App.pedirleASecretaria();
        else if (t === 'secretaria' && App.Ajustes) App.Ajustes.abrir('secretaria');
        else if (t === 'flujos') App.Flujos.abrir();
      });
      if (App.Oficina.alPasar && App.Paleta) App.Oficina.alPasar(App.Paleta.pista);
    }
    pintarTodo();
    if (App.Entregables) App.Entregables.refrescar();
    App.Reunion.retomar();
    App.Biblioteca.vigilarEstado();
    if (App.Conocimiento) App.Conocimiento.vigilarEstado();
    if (App.Tareas) App.Tareas.vigilar();
    /* la ruta (#/charlas/…) decide qué se ve; al cambiar de oficina se vuelve a la maqueta */
    if (!primera || !/^#\/\w/.test(location.hash)) history.replaceState(null, '', App.movil ? '#/bandeja/hoy' : '#/oficina');
    App.Nav.aplicar();
  }
  App.montar = montar;

  /* se llama cada vez que cambia la oficina (contratar, editar, departamentos) */
  function actualizar(oficina) {
    if (oficina) E.oficina = oficina;
    pintarTodo();
  }
  App.actualizar = actualizar;
  App.recargarOficina = function () { return api.get('/api/oficina').then(function (r) { E.carpeta = r.carpeta; actualizar(r.oficina); return r.oficina; }); };

  function pintarTodo() {
    var o = E.oficina;
    dom.nombre.textContent = o.nombre;
    dom.sub.textContent = o.duenio ? 'de ' + o.duenio + ' · ' + o.agentes.length + ' ' + (o.agentes.length === 1 ? 'agente' : 'agentes') : o.agentes.length + ' agentes';
    pintarEquipo();
    var t0 = performance.now();
    dom.carga.classList.remove('oculto');
    App.Oficina.construir(o, App.Yo.perfil()).then(function () { dom.carga.classList.add('oculto'); if (App.Agente.actual()) App.Oficina.elegir(App.Agente.actual()); })
      .catch(function (e) { dom.carga.textContent = 'No pude dibujar la oficina: ' + e.message; console.error(e); });
  }

  /* «recepcion» no es un departamento de la oficina: es el id (de antes) de quien atiende la secretaría, que tiene su
     despacho al lado del tuyo. Se muestra como «Secretaría» */
  App.RECEPCION = { id: 'recepcion', nombre: 'Secretaría', color: '#b9a27a' };
  App.depto = function (id) { return (E.oficina.departamentos || []).filter(function (d) { return d.id === id; })[0] || (id === 'recepcion' ? App.RECEPCION : null); };
  App.agente = function (id) { return (E.oficina.agentes || []).filter(function (a) { return a.id === id; })[0] || null; };

  function pintarEquipo() {
    var o = E.oficina, c = App.vaciar(dom.equipo);
    c.appendChild(App.Yo.fila());
    if (!o.agentes.length) {
      c.appendChild(h('div.vacio', h('p', 'Todavía no hay nadie en la oficina.'), h('button.btn.primario', { style: { marginTop: '12px' }, onclick: function () { App.Contratar.abrir(); } }, App.icono('mas'), 'Contratar al primero')));
    }
    var deps = o.departamentos.slice();
    if (!deps.some(function (d) { return d.id === 'recepcion'; }) && o.agentes.some(function (a) { return a.departamento === 'recepcion'; })) deps.unshift(App.RECEPCION);
    var sueltos = o.agentes.filter(function (a) { return !App.depto(a.departamento); });
    if (sueltos.length) deps.push({ id: '__sin', nombre: 'Sin departamento', color: '#9a9a9a' });
    deps.forEach(function (d) {
      var ags = d.id === '__sin' ? sueltos : o.agentes.filter(function (a) { return a.departamento === d.id; });
      /* la lista del equipo (sección Equipo) abre la ficha de cada uno; los departamentos se arman en Equipo › Departamentos */
      if (!ags.length) return;
      c.appendChild(h('div.grupo-tit', h('span.punto', { style: { background: d.color } }), d.nombre, h('span.cuenta', ags.length)));
      ags.forEach(function (a) {
        var fila = h('div.persona', { 'data-id': a.id, onclick: function () { App.Nav.ir('#/equipo/' + encodeURIComponent(a.id)); } },
          App.retratoImg(a, 'retrato', 96), h('div.persona-txt', h('div.persona-nombre', a.nombre), h('div.persona-rol', a.rol)), h('span.estado-dot'));
        c.appendChild(fila);
      });
    });
    marcarEstados();
    if (App.Actividad) { App.Actividad.repintar(); App.Actividad.iniciar(); }
  }
  function marcarEstados() {
    if (!dom.equipo) return;
    var enReu = E.reunion && E.reunion.estado !== 'cerrada' ? E.reunion.agentes || [] : [];
    dom.equipo.querySelectorAll('.persona[data-id]').forEach(function (el) {
      var id = el.getAttribute('data-id');
      el.classList.toggle('activa', App.Agente.actual() === id);
      el.classList.toggle('ocupada', !!E.ocupados[id] || !!(E.actividad || {})[id]);
      el.classList.toggle('reunida', enReu.indexOf(id) >= 0);
    });
  }
  App.marcarEstados = marcarEstados;

  /* ---------------- menú de la oficina ---------------- */
  function menuOficina(ancla) {
    api.get('/api/oficinas').then(function (r) { return r.oficinas || []; }).catch(function () { return []; }).then(function (lista) {
      var items = [{ titulo: 'Oficinas' }];
      lista.forEach(function (o) {
        items.push({ texto: o.nombre, icono: 'edificio', nota: o.carpeta === E.carpeta ? 'actual' : '', accion: function () { if (o.carpeta !== E.carpeta) { App.Agente.cerrar(); abrirCarpeta(o.carpeta); } } });
      });
      /* crear, armar charlando, abrir o importar: las mismas cuatro opciones que la pantalla de inicio, sin hoja intermedia */
      items.push('-');
      opcionesOficina().forEach(function (o) { items.push({ texto: o.texto, icono: o.icono, accion: o.accion }); });
      /* Ajustes no va acá: tiene su lugar fijo abajo en el riel */
      App.menu(ancla, items);
    });
  }

  /* crear, armar charlando, abrir o importar: las mismas opciones que la pantalla de inicio, en una hoja */
  function otraOficina() {
    var hj = App.hoja({ titulo: 'Otra oficina', ancho: 480, sinPie: true });
    App.add(hj.cuerpo, opcionesOficina().map(function (o) {
      return h('button.opcion', { onclick: function () { hj.cerrar(); o.accion(); } }, App.icono(o.icono), h('div', h('b', o.texto), h('span', o.bajada)));
    }));
  }

  /* sección «General» de Ajustes: nombre, quién dirige y carpeta. `crear` (opcional) reemplaza a App.hoja. */
  function editarOficina(crear) {
    var hj = (crear || App.hoja)({ titulo: 'General', ancho: 440 });
    var n = h('input.campo', { value: E.oficina.nombre, maxlength: 80, autofocus: !hj.enVentana });
    var err = h('div.error-txt');
    var quien = h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, App.Yo.retrato('retrato', 96), h('b', App.Yo.nombre() || 'Sin nombre todavía'),
      h('button.btn.chico', { style: { marginLeft: 'auto' }, onclick: function () { if (!hj.enVentana) hj.cerrar(); App.Yo.abrir(); } }, 'Cambiar…'));
    var carpeta = h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } }, App.icono('carpeta'),
      h('span', { style: { color: 'var(--suave)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }, title: E.carpeta }, E.carpeta),
      h('button.btn.chico', { style: { marginLeft: 'auto', flex: 'none' }, onclick: function () { if (App.nativo.hay) App.nativo.revelar(E.carpeta); else { if (!hj.enVentana) hj.cerrar(); App.Nav.ir('#/archivos/carpeta'); } } },
        App.nativo.hay ? 'Mostrar' : 'Ver archivos'));
    App.add(hj.cuerpo, h('div.fila-campo', h('label.etiqueta-campo', 'Nombre'), n),
      h('div.fila-campo', h('label.etiqueta-campo', 'Quién la dirige'), quien, h('div.ayuda', 'Cada oficina tiene su propio director.')),
      h('div.fila-campo', h('label.etiqueta-campo', 'Carpeta'), carpeta, h('div.ayuda', 'Ahí quedan los agentes, su conocimiento, las actas y los archivos.')), err);
    App.add(hj.pie, hj.enVentana ? null : h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), h('button.btn.primario', {
      onclick: function () {
        err.textContent = '';
        api.patch('/api/oficina', { nombre: n.value.trim() }).then(function (r) { actualizar(r.oficina); hj.cerrar(); if (hj.enVentana) App.aviso('Guardado.'); }).catch(function (e) { err.textContent = e.message; });
      }
    }, 'Guardar'));
  }

  /* Esc hace lo mismo que la × de la ventana abierta (la del panel, que sabe limpiar lo suyo; en una sección, volver a la
     oficina). Lo llama el Esc global de base.js cuando no queda ningún menú ni hoja por cerrar. */
  App.alEscape = function () { cerrarDesdeBarra(); };
  App.abrirDerecho = function (modo) {
    var antes = App.modoDerecho();
    dom.derecho.classList.add('abierto'); dom.derecho.setAttribute('data-modo', modo); App.Nav.alAbrir(modo);
    if ((antes === 'permisos' || antes === 'parte' || modo === 'parte') && App.Permisos) App.Permisos.repintar();   // vuelven a flotar
  };
  /* `silencioso`: lo cierra la navegación misma (va a pintar otra cosa); si no, en una sección queda el panel vacío */
  App.cerrarDerecho = function (silencioso) {
    var m = dom.derecho.getAttribute('data-modo');
    dom.derecho.classList.remove('abierto');
    dom.derecho.removeAttribute('data-modo');
    alCerrarModo(m);
    if ((m === 'permisos' || m === 'parte') && App.Permisos) App.Permisos.repintar();
    App.Nav.alCerrar(silencioso === true);
  };
  function alCerrarModo(m) {
    if (m === 'agente') App.Agente.alCerrar(); else if (m === 'reunion') App.Reunion.alCerrarPanel();
    else if (m === 'entregables' && App.Entregables) App.Entregables.alCerrarPanel();
    else if (m === 'parte' && App.Parte && App.Parte.alCerrarPanel) App.Parte.alCerrarPanel();
    else if (m === 'tareas' && App.Tareas) App.Tareas.alCerrarPanel();
    else if (m === 'flujos' && App.Flujos && App.Flujos.alCerrarPanel) App.Flujos.alCerrarPanel();
  };
  /* La × de cada ventana (Biblioteca, una charla, Tareas…): el riel abre ventanas de a una y la × la cierra. En la compu
     vuelve a la oficina, como mostrar el escritorio; en el celular, a la lista de la sección. */
  App.cerrarVentana = function () {
    if (App.Nav.enSeccion() && !window.matchMedia('(max-width: 720px)').matches) App.Nav.ir('#/oficina');
    else if (App.modoDerecho()) App.cerrarDerecho();
  };
  /* La × de la barra de la ventana: aprieta la × del panel (la que sabe limpiar lo suyo, p. ej. el Creador) y, si el
     panel no tiene, cierra la ventana como siempre. */
  function cerrarDesdeBarra() {
    var x = App.modoDerecho() ? dom.derecho.querySelector('.cerrar-panel') : null;
    if (x) x.click(); else App.cerrarVentana();
  }
  /* Mover la ventana del riel arrastrando su barra fina (sólo en la compu: en el celular ocupa la pantalla y la barra
     está oculta). El corrimiento va en --mov-x/--mov-y y lo aplica el CSS con `translate`, así no toca el acomodo de
     nav.js. Siempre queda a la vista un pedazo de la barra. Doble clic en la barra la devuelve a su lugar. */
  function moverVentana(ven, barra) {
    var ASOMA = 80, ox = 0, oy = 0;
    function poner(x, y) {
      ox = Math.round(x); oy = Math.round(y);
      ven.style.setProperty('--mov-x', ox + 'px'); ven.style.setProperty('--mov-y', oy + 'px');
    }
    /* entre los límites de la vista, con el corrimiento ya puesto (también al achicarse la ventana de la app) */
    function limitar() {
      if (!ox && !oy) return;
      var r = ven.getBoundingClientRect(), v = ven.parentNode.getBoundingClientRect();
      if (!r.width) return;
      var nl = Math.max(v.left + ASOMA - r.width, Math.min(v.right - ASOMA, r.left));
      var nt = Math.max(v.top, Math.min(v.bottom - barra.offsetHeight, r.top));
      if (nl !== r.left || nt !== r.top) poner(ox + nl - r.left, oy + nt - r.top);
    }
    window.addEventListener('resize', limitar);
    barra.addEventListener('dblclick', function (e) { if (!e.target.closest('button, a, input')) poner(0, 0); });
    barra.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button, a, input')) return;
      e.preventDefault();
      var x0 = e.clientX, y0 = e.clientY, ox0 = ox, oy0 = oy;
      var r0 = ven.getBoundingClientRect(), v = ven.parentNode.getBoundingClientRect();
      barra.setPointerCapture && barra.setPointerCapture(e.pointerId);
      document.body.classList.add('arrastrando-hoja'); document.body.style.cursor = 'grabbing';
      function mover(ev) {
        var nl = Math.max(v.left + ASOMA - r0.width, Math.min(v.right - ASOMA, r0.left + ev.clientX - x0));
        var nt = Math.max(v.top, Math.min(v.bottom - barra.offsetHeight, r0.top + ev.clientY - y0));
        poner(ox0 + nl - r0.left, oy0 + nt - r0.top);
      }
      function soltar() {
        barra.removeEventListener('pointermove', mover); barra.removeEventListener('pointerup', soltar); barra.removeEventListener('pointercancel', soltar);
        document.body.classList.remove('arrastrando-hoja'); document.body.style.cursor = '';
      }
      barra.addEventListener('pointermove', mover); barra.addEventListener('pointerup', soltar); barra.addEventListener('pointercancel', soltar);
    });
  }
  /* La ruta de la barra: la sección y, si hay algo abierto en el panel, su título (el nombre del agente, «Contratar»…) */
  function pintarRuta() {
    if (!dom.ruta) return;
    var sec = App.Nav.nombreSeccion();
    var m = App.modoDerecho(), h2 = m && m !== 'vacio' ? dom.derecho.querySelector('.der-cab h2') : null;
    var tit = h2 ? h2.textContent.trim() : '';
    var clave = sec + '\u0000' + tit;
    if (dom.ruta.getAttribute('data-clave') === clave) return;
    dom.ruta.setAttribute('data-clave', clave);
    App.add(App.vaciar(dom.ruta), tit ? h('span', sec) : h('b', sec), tit ? h('span.sep', '›') : null, tit ? h('b', { title: tit }, tit) : null);
  }
  App.modoDerecho = function () { return dom.derecho && dom.derecho.classList.contains('abierto') ? dom.derecho.getAttribute('data-modo') : null; };
  App.volverAlInicio = inicio;

  window.addEventListener('DOMContentLoaded', arrancar);
})();
