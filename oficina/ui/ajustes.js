/* Ajustes de la oficina (docs/plan-creador-flujos.md §9 y §12): hojas «Reglas de la oficina» y «Conectores».
   Reglas: lista editable que se guarda entera con PUT /api/reglas. Conectores: lo que detectó claude en claude.ai y la tabla
   agente × servidor con Leer y Actuar (cada check asigna todas las herramientas de ese tipo). */
window.App = window.App || {};
App.Ajustes = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var api = function () { return App.api; };
  var MAX_REGLAS = 40;

  /* App.api no tiene PUT (base.js no es de este módulo): mismo contrato de errores que App.api */
  function put(ruta, cuerpo) {
    return fetch(ruta, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : {}; } catch (e) { d = null; }
        if (!r.ok) { var e = new Error((d && d.error) || ('Error ' + r.status)); e.status = r.status; throw e; }
        return d || {};
      });
    });
  }

  /* Conectores nuevos de un agente. `porServ` = {servidor: {leer?: bool, actuar?: bool}} con lo que la persona tocó: eso se reemplaza
     por todas las herramientas de ese tipo; lo que no se tocó (y los servidores que ya no aparecen) queda como estaba. */
  function delTipo(s, tipo) { return (s.herramientas || []).filter(function (t) { return t.tipo === tipo; }).map(function (t) { return t.nombre; }); }
  function nuevosConectores(a, servidores, porServ) {
    porServ = porServ || {};
    var orig = a.conectores || [], salida = [];
    function serv(nom) { return (servidores || []).filter(function (x) { return x.nombre === nom; })[0]; }
    orig.forEach(function (c) {
      if (!serv(c.servidor) || !porServ[c.servidor]) salida.push({ servidor: c.servidor, leer: (c.leer || []).slice(), actuar: (c.actuar || []).slice() });
    });
    Object.keys(porServ).forEach(function (nom) {
      var s = serv(nom); if (!s) return;
      var o = orig.filter(function (c) { return c.servidor === nom; })[0] || { leer: [], actuar: [] };
      var t = porServ[nom], leer = (o.leer || []).slice(), actuar = (o.actuar || []).slice();
      if (t.leer !== undefined) leer = t.leer ? delTipo(s, 'leer') : [];
      if (t.actuar !== undefined) actuar = t.actuar ? delTipo(s, 'actuar') : [];
      if (t.leer !== undefined && t.actuar === undefined) actuar = actuar.filter(function (n) { return leer.indexOf(n) < 0; });
      if (t.actuar !== undefined && t.leer === undefined) leer = leer.filter(function (n) { return actuar.indexOf(n) < 0; });
      if (leer.length || actuar.length) salida.push({ servidor: nom, leer: leer, actuar: actuar });
    });
    return salida;
  }

  /* «claude_ai_Gmail» → «Gmail»: el nombre del servidor como se lo dirías a alguien */
  function nombreServidor(n) {
    var t = String(n || '').replace(/^claude[_ .-]?ai[_ .-]+/i, '').replace(/^plugin_[^_]+_/, '').replace(/[_-]+/g, ' ').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : String(n || '');
  }

  /* ---------------- reglas ---------------- */
  /* `crear` (opcional) reemplaza a App.hoja: la ventana de Ajustes lo usa para dibujar la sección adentro */
  function reglas(crear) {
    var hj = (crear || App.hoja)({ titulo: 'Reglas de la oficina', ancho: 580 });
    var lista = h('div'), err = h('div.error-txt');
    var filas = [];     // [{id, origen, txt}]
    var guardar = h('button.btn.primario', { disabled: true, onclick: enviar }, 'Guardar');
    var mas = h('button.btn.izq', { onclick: function () { agregar({ texto: '' }, true); } }, App.icono('mas'), 'Nueva regla');
    App.add(hj.cuerpo, h('div.ayuda', { style: { marginTop: 0, marginBottom: '12px' } }, 'Valen para todos los agentes: se suman a sus instrucciones.'), lista, err);
    App.add(hj.pie, mas, hj.enVentana ? null : h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), guardar);
    App.add(lista, App.cargando('Trayendo las reglas…'));

    function vacia() {
      if (!filas.length) lista.appendChild(h('div.vacio', 'Todavía no hay reglas. Por ejemplo: «No inventes datos: si falta algo, preguntalo».'));
    }
    function agregar(r, foco) {
      var item = { id: r.id, origen: r.origen };
      item.txt = h('textarea.campo', { rows: 2, maxlength: 600, placeholder: 'Una regla corta y concreta, en segunda persona.' });
      item.txt.value = r.texto || '';
      item.el = h('div.regla-fila', h('div.regla-cuerpo', item.txt, r.origen ? h('div.regla-cita', r.origen) : null),
        h('button.btn.fantasma.icono', { title: 'Quitar', onclick: function () {
          filas.splice(filas.indexOf(item), 1); item.el.remove(); vacia();
        } }, App.icono('papelera')));
      if (!filas.length) App.vaciar(lista);
      filas.push(item); lista.appendChild(item.el);
      if (filas.length >= MAX_REGLAS) mas.disabled = true;
      if (foco) item.txt.focus();
    }
    function enviar() {
      var rs = filas.map(function (f) {
        var o = { texto: f.txt.value.trim() };
        if (f.id) o.id = f.id;
        if (f.origen) o.origen = f.origen;
        return o;
      }).filter(function (o) { return o.texto; });
      guardar.disabled = true; err.textContent = '';
      put('/api/reglas', { reglas: rs }).then(function () {
        hj.cerrar();
        App.aviso(rs.length ? 'Reglas guardadas.' : 'Sin reglas.');
      }).catch(function (e) { err.textContent = e.message; guardar.disabled = false; });
    }

    api().get('/api/reglas').then(function (r) {
      App.vaciar(lista);
      (r.reglas || []).forEach(function (x) { agregar(x); });
      vacia();
      guardar.disabled = false;
    }).catch(function (e) { App.vaciar(lista).appendChild(h('div.error-txt', e.message)); });
  }

  /* ---------------- conectores ----------------
     Arriba la decisión (todos usan todos / elegir por agente); después cada servidor detectado, con su detalle plegado; y,
     si se elige por agente, qué usa cada uno. Todo se guarda al tocarlo (con «Deshacer»). */
  function conectores(crear) {
    var vivo = true, reloj = null;
    var actualizar = h('button.btn.chico', { onclick: refrescar }, App.icono('recargar'), 'Actualizar');
    var hj = crear({ titulo: 'Conectores', ancho: 760, acciones: [actualizar], alCerrar: function () { vivo = false; clearTimeout(reloj); } });
    var cont = h('div'), err = h('div.error-txt');
    var datos = null;
    var cola = Promise.resolve();   // los guardados de a uno: cada uno parte de lo que quedó guardado
    App.add(hj.cuerpo, cont, err);
    /* en una ventana suelta (no en Ajustes) no hay cabecera de sección: «Actualizar» va en el pie */
    if (!hj.enVentana) App.add(hj.pie, actualizar, h('button.btn.primario', { onclick: hj.cerrar }, 'Listo'));
    App.add(cont, App.cargando('Trayendo los conectores…'));

    function cargar() {
      api().get('/api/conectores').then(function (r) {
        if (!vivo) return;
        datos = r;
        pintar();
        // mientras detecta, se vuelve a preguntar cada 2 s
        clearTimeout(reloj);
        if (r.detectando) reloj = setTimeout(function () { if (vivo) cargar(); }, 2000);
      }).catch(function (e) { if (vivo) App.vaciar(cont).appendChild(h('div.error-txt', e.message)); });
    }
    function refrescar() {
      actualizar.disabled = true; err.textContent = '';
      // el POST espera a que termine la detección: mientras tanto se muestra «detectando»
      if (datos) { datos.detectando = true; pintar(); }
      api().post('/api/conectores/actualizar').then(function (r) {
        if (!vivo) return;
        if (r.error) err.textContent = r.error;
        datos = r; pintar();
      }).catch(function (e) { if (vivo) { err.textContent = e.message; if (datos) { datos.detectando = false; pintar(); } } })
        .then(function () { actualizar.disabled = false; });
    }

    function insigniaTipo(t) { return h('span.insignia.' + (t === 'leer' ? 'leer' : 'actuar'), t === 'leer' ? 'leer' : 'actuar'); }

    /* «3 para leer · 2 para actuar» */
    function resumen(s) {
      var l = delTipo(s, 'leer').length, a = delTipo(s, 'actuar').length;
      return [l ? l + ' para leer' : null, a ? a + ' para actuar' : null].filter(Boolean).join(' · ') || 'Sin herramientas';
    }
    function filaServidor(s) {
      var tools = s.herramientas || [];
      return h('details.cx-fila' + (s.disponible ? '' : '.no'),
        h('summary',
          h('span.cx-nom', nombreServidor(s.nombre)),
          s.disponible ? null : h('span.insignia', s.estado === 'needs-auth' ? 'Falta autorizar' : 'No disponible'),
          h('span.cx-resumen', s.disponible ? resumen(s) : 'Conectalo en claude.ai')),
        tools.length ? h('div.cx-herr', tools.map(function (t) { return h('span', insigniaTipo(t.tipo), t.corto); })) : null);
    }

    function pintar() {
      App.vaciar(cont);
      var servs = (datos && datos.servidores) || [];
      if (datos.detectando) {
        cont.appendChild(h('div.ayuda.cx-estado', 'Mirando qué conectores tenés en claude.ai… puede tardar un minuto. Mientras tanto ves lo último que se detectó.'));
      } else if (datos.detectado) {
        cont.appendChild(h('div.ayuda.cx-estado', 'Detectado ' + App.hace(datos.detectado) + '.'));
      }
      var disp = servs.filter(function (s) { return s.disponible; });
      var agentes = (App.E.oficina && App.E.oficina.agentes) || [];
      if (!servs.length) {
        if (!datos.detectando) cont.appendChild(App.vacio('enchufe', 'No se detectó ningún conector', 'Conectalos en claude.ai y tocá «Actualizar».'));
        return;
      }
      if (disp.length && agentes.length) cont.appendChild(eleccionAcceso());
      cont.appendChild(App.seccion('Conectores detectados', h('div.cx-lista', servs.map(filaServidor)),
        { ayuda: 'Leer son las herramientas que solo consultan. Actuar son las que hacen algo afuera, y siempre piden tu aprobación.' }));
      if (!disp.length || !agentes.length || modoAcceso() === 'todos') return;
      var cab1 = h('tr', h('th', 'Agente'), disp.map(function (s) { return h('th', { colspan: 2 }, nombreServidor(s.nombre)); }));
      var cab2 = h('tr.cx-sub', h('th'), disp.map(function () { return [h('th', 'Leer'), h('th', 'Actuar')]; }));
      var filas = agentes.map(function (a) {
        return h('tr', h('td', h('span.cx-agente', App.retratoImg(a, 'retrato', 64), a.nombre)),
          disp.map(function (s) { return [celda(a, s, 'leer'), celda(a, s, 'actuar')]; }));
      });
      cont.appendChild(App.seccion('Qué usa cada agente', h('div.cx-tabla-caja', h('table.cx-tabla', h('thead', cab1, cab2), h('tbody', filas)))));
    }

    /* `conectores_agentes` (toda la app, PUT /api/preferencias): «todos» = cada agente usa todos los conectores
       conectados (leer libre; actuar siempre como propuesta que aprobás); «por_agente» = la tabla de abajo. */
    function modoAcceso() { return (App.E.estado && App.E.estado.conectores_agentes) || 'por_agente'; }
    var ACCESOS = [
      { valor: 'todos', titulo: 'Todos los agentes usan todos los conectores · más simple',
        sub: 'Cada agente puede leer con cualquier conector conectado. Mandar, publicar o crear algo afuera sigue siendo una propuesta que aprobás vos.' },
      { valor: 'por_agente', titulo: 'Elegir por agente',
        sub: 'Marcás en una tabla qué conectores usa cada agente, para leer y para actuar.' },
    ];
    function eleccionAcceso() {
      var el = App.elegir({ forma: 'lista', etiqueta: 'Acceso de los agentes', opciones: ACCESOS, valor: modoAcceso(), alCambiar: elegirAcceso });
      return App.seccion('Acceso de los agentes', el);
    }
    function elegirAcceso(id) {
      var antes = modoAcceso();
      if (id === antes) return;
      err.textContent = '';
      function poner(v, silencioso) {
        return api().put('/api/preferencias', { conectores_agentes: v }).then(function (r) {
          if (App.E && App.E.estado) App.E.estado.conectores_agentes = r.conectores_agentes;
          if (!vivo) return;
          if (!silencioso) App.guardado(v === 'todos' ? 'Todos los agentes usan todos los conectores.' : 'Elegís qué conectores usa cada agente.', function () { poner(antes, true); });
          pintar();
        }).catch(function (e) { if (vivo) { err.textContent = e.message; pintar(); } });
      }
      poner(id);
    }

    function asignado(a, s) {
      var ag = App.agente(a.id) || a;
      return ((ag.conectores || []).filter(function (c) { return c.servidor === s.nombre; })[0]) || { leer: [], actuar: [] };
    }
    function celda(a, s, tipo) {
      var todas = delTipo(s, tipo);
      var td = h('td');
      if (!todas.length) { td.appendChild(h('span', { style: { color: 'var(--tenue)' } }, '–')); return td; }
      var asig = asignado(a, s), lista = (asig[tipo] || []);
      var tiene = todas.filter(function (n) { return lista.indexOf(n) >= 0; }).length;
      var ck = h('input', { type: 'checkbox', title: (tipo === 'leer' ? 'Puede leer con ' : 'Puede actuar con ') + nombreServidor(s.nombre) });
      ck.checked = tiene === todas.length; ck.indeterminate = tiene > 0 && tiene < todas.length;
      ck.addEventListener('change', function () { ck.indeterminate = false; guardarCelda(a.id, s.nombre, tipo, ck); });
      td.appendChild(ck);
      return td;
    }

    /* se guarda al marcar: un PATCH por cambio, en fila, sobre lo último guardado */
    function guardarCelda(id, serv, tipo, ck) {
      var valor = ck.checked, previo = null, nombre = '';
      cola = cola.then(function () {
        var ag = App.agente(id); if (!ag) return null;
        nombre = ag.nombre;
        previo = JSON.parse(JSON.stringify(ag.conectores || []));
        var t = {}; t[tipo] = valor;
        var porServ = {}; porServ[serv] = t;
        return api().patch('/api/agentes/' + encodeURIComponent(id), { conectores: nuevosConectores(ag, datos.servidores, porServ) }).then(function (r) {
          App.actualizar(r.oficina);
          App.guardado(nombre + ': ' + nombreServidor(serv) + ' guardado.', function () {
            api().patch('/api/agentes/' + encodeURIComponent(id), { conectores: previo }).then(function (r2) { App.actualizar(r2.oficina); if (vivo) pintar(); }).catch(App.fallo);
          });
        });
      }).catch(function (e) { App.fallo(e); ck.checked = !valor; });
    }

    cargar();
  }

  /* ---------------- ventana de Ajustes ----------------
     Una sola hoja con las secciones a la izquierda (en el celular, la lista primero y al tocar se entra). Cada sección es
     la misma función que antes abría su propia hoja: recibe `crear` en lugar de App.hoja y dibuja adentro. Ahí, `cerrar`
     vuelve a dibujar la sección (después de guardar se ve lo guardado) y `enVentana` le avisa que no ponga «Cancelar». */
  var atajo = /Mac/.test(navigator.platform || navigator.userAgent) ? '⌘,' : 'Ctrl+,';

  function modoPermisos() {
    var m = App.E.estado && App.E.estado.modo_permisos;
    return m === 'auto' ? 'Automático' : m === 'preguntar' ? 'Preguntarme siempre' : '';
  }
  var SECCIONES = [
    { id: 'general', grupo: 'oficina', texto: 'General', icono: 'edificio', pintar: function (c) { App.editarOficina(c); } },
    { id: 'reglas', grupo: 'oficina', texto: 'Reglas', icono: 'regla', pintar: function (c) { reglas(c); } },
    { id: 'secretaria', grupo: 'oficina', texto: 'Secretaría', icono: 'bandeja', visible: function () { return !!App.Secretaria; }, pintar: function (c) { App.Secretaria.pintar(c); } },
    { id: 'conectores', grupo: 'oficina', texto: 'Conectores', icono: 'enchufe', pintar: function (c) { conectores(c); } },
    { id: 'habilitados', grupo: 'oficina', texto: 'Skills y MCP', icono: 'chispa', pintar: habilitados },
    { id: 'trabajo', grupo: 'oficina', texto: 'Carpetas de trabajo', icono: 'carpeta', pintar: carpetasTrabajo,
      nota: function () { var n = ((App.E.oficina && App.E.oficina.carpetasTrabajo) || []).length; return n ? String(n) : ''; } },
    { id: 'avanzado', grupo: 'oficina', texto: 'Avanzado', icono: 'deslizadores', pintar: avanzado },
    /* la elige la persona la primera vez que abre la app (permisos.js); acá se ve y se cambia */
    { id: 'permisos', grupo: 'app', texto: 'Permisos de los agentes', icono: 'escudo', nota: modoPermisos,
      visible: function () { return !!(App.Permisos && (App.Permisos.pintarModo || App.Permisos.abrirModo)); }, pintar: permisos },
    { id: 'ia', grupo: 'app', texto: 'Modelos y consumo', icono: 'medidor', pintar: iaAjustes },
    { id: 'celular', grupo: 'app', texto: 'Celular', icono: 'telefono', visible: function () { return !!(App.Celular && App.nativo.hay); },
      nota: function () { return App.Celular.nota(); }, pintar: function (c) { App.Celular.pintar(c); } },
    /* solo en la versión web (en el navegador): la app de escritorio se actualiza sola desde las releases */
    { id: 'actualizar', grupo: 'app', texto: 'Actualizar', icono: 'recargar', visible: function () { return !App.nativo.hay; }, pintar: actualizarWeb },
    { id: 'whatsapp', grupo: 'app', texto: 'WhatsApp', icono: 'charla', visible: function () { return !!App.WhatsApp; }, pintar: function (c) { App.WhatsApp.pintar(c); } },
  ];

  /* Sección «Modelos y consumo» (toda la app, PUT /api/preferencias): qué modelo usa cada proceso que no es un agente y
     cuánto gasta la IA. El modelo y el esfuerzo de cada agente se eligen en su ficha. Se guarda al elegir. */
  var PROCESOS = [
    { clave: 'creador', titulo: 'Creador', bajada: 'El de la recepción, que arma y cambia la oficina charlando.' },
    { clave: 'internos', titulo: 'Tareas de fondo', bajada: 'Borradores de agentes nuevos, fichas e imágenes de la biblioteca y resúmenes de reuniones.' },
  ];
  /* qué modelo usa cada proceso no-agente; vale desde la próxima corrida */
  function cuerpoModelos(hj, err) {
    var actual = Object.assign({}, (App.E.estado && App.E.estado.modelos) || {});
    function titulo(v) { var m = (App.MODELOS || []).filter(function (x) { return x.valor === v; })[0]; return m ? m.titulo : v; }
    PROCESOS.forEach(function (p) {
      var el = App.elegir({ forma: 'deslizador', etiqueta: p.titulo, valor: actual[p.clave],
        opciones: App.modeloOpciones(),
        alCambiar: function (v) { poner(p, v, false); } });
      function poner(p2, v, silencioso) {
        var antes = actual[p2.clave];
        var cuerpo = { modelos: {} }; cuerpo.modelos[p2.clave] = v;
        err.textContent = '';
        api().put('/api/preferencias', cuerpo).then(function (r) {
          if (App.E && App.E.estado) App.E.estado.modelos = r.modelos;
          actual = Object.assign({}, (App.E.estado && App.E.estado.modelos) || actual);
          if (!silencioso) App.guardado(p2.titulo + ': ' + titulo(v) + '.', antes ? function () { el.poner(antes); poner(p2, antes, true); } : null);
        }).catch(function (e) { err.textContent = e.message; el.poner(actual[p2.clave]); });
      }
      hj.cuerpo.appendChild(App.ajuste(p.titulo, p.bajada, el));
    });
  }

  /* esfuerzo y opciones de consumo por defecto para todo lo que usa la IA (charlas, reuniones, tareas, flujos, consultas).
     El esfuerzo de un agente (su ficha) le gana, y cada charla o reunión nueva puede cambiarlos para sí. */
  function cuerpoConsumo(hj, err) {
    /* guarda varias claves juntas (el nivel de ahorro fija cuatro); deshacer vuelve a las de antes */
    function guardar(cambios, texto) {
      var ia = App.iaApp(), antes = {};
      Object.keys(cambios).forEach(function (k) { antes[k] = ia[k]; });
      err.textContent = '';
      api().put('/api/preferencias', { ia: cambios }).then(function (r) {
        if (App.E && App.E.estado) App.E.estado.ia = r.ia;
        sincronizar();
        App.guardado(texto + '.', function () { guardar(antes, texto + ' (deshecho)'); });
      }).catch(function (e) { err.textContent = e.message; sincronizar(); });
    }
    function uno(k, v, texto) { var c = {}; c[k] = v; guardar(c, texto); }
    var ia = App.iaApp(), controles = [];
    var esf = App.elegir({ forma: 'deslizador', etiqueta: 'Esfuerzo', valor: ia.esfuerzo,
      opciones: App.ESFUERZOS.map(function (m) { return { valor: m.valor, titulo: m.titulo, sub: m.sub, aparte: m.valor === '' }; }),
      alCambiar: function (v) { uno('esfuerzo', v, 'Esfuerzo: ' + App.tituloEsfuerzo(v)); } });
    /* un nivel de ahorro en vez de cuatro decisiones; el detalle queda plegado para quien quiera elegir cada una */
    var detalle = h('details.avanzado.consumo-detalle', h('summary', 'Elegir cada opción por separado'));
    var ahorro = App.controlAhorro(App.ahorroDe(ia), function (a) {
      var nivel = App.AHORROS.filter(function (x) { return x.valor === a; })[0];
      if (nivel) guardar(nivel.ia, 'Ahorro de tokens: ' + nivel.titulo.toLowerCase());
      else { detalle.open = true; sincronizar(); }
    });
    App.OPCIONES_IA.forEach(function (o) {
      var el = App.controlOpcionIA(o, ia[o.clave], function (v) { uno(o.clave, v, o.titulo + ': ' + App.tituloOpcionIA(o, v)); });
      controles.push({ clave: o.clave, el: el });
      detalle.appendChild(App.ajuste(o.titulo, o.sub, el));
    });
    if (App.ahorroDe(ia) === 'medida') detalle.open = true;
    function sincronizar() {
      var x = App.iaApp();
      esf.poner(x.esfuerzo);
      ahorro.poner(App.ahorroDe(x));
      controles.forEach(function (c) { c.el.poner(x[c.clave]); });
    }
    App.add(hj.cuerpo,
      App.ajuste('Esfuerzo', 'Cuánto piensa antes de responder. Lo que piensa se cobra como texto escrito: para el día a día, Bajo o Medio alcanza.', esf),
      App.ajuste('Ahorro de tokens', 'Cuánto contexto lee y cuántas herramientas tiene a mano en cada paso. Más ahorro, menos gasto, pero sabe y puede hacer menos sin que se lo pidas.', ahorro),
      detalle);
  }

  /* la sección junta las dos cosas: qué modelo usa cada proceso y cuánto gasta la IA (son todo preferencias de IA de la app) */
  function iaAjustes(crear) {
    var hj = crear({ titulo: 'Modelos y consumo' });
    var err = h('div.error-txt');
    App.add(hj.cuerpo, h('div.ayuda', { style: { marginTop: 0 } },
      'Qué modelo usa cada parte de la app y cuánto gasta la IA. Vale para todas tus oficinas; el modelo y el esfuerzo de cada agente se eligen en su ficha, y cada charla o reunión nueva lo puede cambiar para sí.'));
    App.add(hj.cuerpo, h('div.aj-subtit', 'Modelos'));
    cuerpoModelos(hj, err);
    App.add(hj.cuerpo, h('div.aj-subtit', 'Consumo'));
    cuerpoConsumo(hj, err);
    hj.cuerpo.appendChild(err);
  }

  /* ---------------- skills, MCP y conectores habilitados (habilitados.ts) ----------------
     Dos niveles: la oficina habilita (PUT /api/oficina/ia) y cada agente elige dentro de eso en su ficha (o hereda).
     `selector` sirve para los dos: un interruptor «todo / solo lo elegido» y, si se eligen, chips con el catálogo.
     op: {etiqueta, opciones: [{valor, titulo, sub?}], valor: lista | undefined (= todo/hereda), todo: {titulo, sub},
          algunas: {titulo, sub}, vacio: texto si no hay catálogo, alCambiar(lista | null)} */
  function selector(op) {
    var lista = op.valor ? op.valor.slice() : null;
    var opciones = op.opciones.slice();
    // lo elegido que ya no está en el catálogo igual se ve (y se puede sacar)
    (lista || []).forEach(function (v) { if (!opciones.some(function (o) { return o.valor === v; })) opciones.push({ valor: v, titulo: v, sub: 'Ya no aparece en tu Claude Code' }); });
    var caja = h('div.sel-hab');
    var chips = null;
    var modo = App.elegir({ forma: 'interruptor', etiqueta: op.etiqueta, valor: lista ? 'algunas' : 'todo',
      opciones: [{ valor: 'todo', titulo: op.todo.titulo, sub: op.todo.sub }, { valor: 'algunas', titulo: op.algunas.titulo, sub: op.algunas.sub }],
      alCambiar: function (v) {
        // al pasar a «solo algunas» arranca con todo marcado: de ahí se sacan las que sobran
        lista = v === 'todo' ? null : opciones.map(function (o) { return o.valor; });
        pintar(); op.alCambiar(lista ? lista.slice() : null);
      } });
    function pintar() {
      if (chips) chips.remove();
      chips = null;
      if (!lista) return;
      chips = opciones.length
        ? App.elegir({ forma: 'chips', multiple: true, etiqueta: op.etiqueta, valor: lista, opciones: opciones,
            alCambiar: function (v) { lista = v; op.alCambiar(v.slice()); } })
        : h('div.ayuda', op.vacio || 'No hay nada para elegir.');
      caja.appendChild(chips);
    }
    App.add(caja, modo);
    pintar();
    caja.poner = function (v) { lista = v ? v.slice() : null; modo.poner(lista ? 'algunas' : 'todo'); pintar(); };
    return caja;
  }
  /* opciones del catálogo de Claude Code: «plugin:skill» se muestra como «skill» (el nombre completo, en el title) */
  function opcionesNombres(l) { return (l || []).map(function (s) { return { valor: s, titulo: s.replace(/^[^:]+:/, ''), sub: s }; }); }

  var TIPOS_HAB = {
    skills: { titulo: 'Skills', uno: 'skill', ayuda: 'Las skills y plugins de tu Claude Code que pueden usar los agentes de esta oficina. Cada una suma su descripción en cada paso.' },
    mcp: { titulo: 'Servidores MCP', uno: 'servidor', ayuda: 'Los MCP que instalaste en Claude Code. Cada uno suma sus herramientas en cada paso.' },
    conectores: { titulo: 'Conectores de claude.ai', uno: 'conector', ayuda: 'Lo que no habilites acá no lo usa ningún agente, aunque se lo hayas asignado.' }
  };
  function habilitados(crear) {
    var hj = crear({ titulo: 'Skills y MCP' });
    var err = h('div.error-txt');
    var zona = h('div', App.cargando('Trayendo lo que tenés en Claude Code…'));
    App.add(hj.cuerpo,
      h('div.ayuda', { style: { marginTop: 0, marginBottom: '12px' } }, 'Lo que habilites acá es lo único que pueden usar los agentes de esta oficina. En la ficha de cada agente (Permisos) podés acotarlo más.'),
      zona, err);
    var cola = Promise.resolve();
    function guardar(clave, v, el, antes) {
      var cuerpo = {}; cuerpo[clave] = v;
      err.textContent = '';
      cola = cola.then(function () {
        return put('/api/oficina/ia', cuerpo).then(function (r) {
          App.actualizar(r.oficina);
          var t = TIPOS_HAB[clave];
          App.guardado(t.titulo + ': ' + (v ? (v.length ? 'solo ' + v.length + ' de la lista' : 'nada habilitado') : 'sin tope') + '.', function () {
            var c2 = {}; c2[clave] = antes === undefined ? null : antes;
            put('/api/oficina/ia', c2).then(function (r2) { App.actualizar(r2.oficina); el.poner(antes); }).catch(App.fallo);
          });
        });
      }).catch(function (e) { err.textContent = e.message; el.poner(antes); });
    }
    function fila(clave, opciones, vacio) {
      var t = TIPOS_HAB[clave];
      var ia = (App.E.oficina && App.E.oficina.ia) || {};
      var el = selector({ etiqueta: t.titulo, opciones: opciones, valor: ia[clave], vacio: vacio,
        todo: { titulo: 'Todos', sub: 'Cada ' + t.uno + ' que tengas, también los que agregues después' },
        algunas: { titulo: 'Solo los que elijas', sub: 'Los que no marques no llegan a ningún agente de la oficina' },
        alCambiar: function (v) { var antes = (((App.E.oficina && App.E.oficina.ia) || {})[clave]); guardar(clave, v, el, antes); } });
      return App.ajuste(t.titulo, t.ayuda, el);
    }
    Promise.all([
      api().get('/api/skills').catch(function () { return { skills: [], mcp: [] }; }),
      api().get('/api/conectores').catch(function () { return { servidores: [] }; })
    ]).then(function (rs) {
      App.vaciar(zona);
      var cx = (rs[1].servidores || []).map(function (s) { return { valor: s.nombre, titulo: nombreServidor(s.nombre), sub: s.disponible ? '' : 'No disponible · conectalo en claude.ai' }; });
      App.add(zona,
        fila('skills', opcionesNombres(rs[0].skills), 'No encontré skills instaladas en tu Claude Code.'),
        fila('mcp', opcionesNombres(rs[0].mcp).map(function (o) { o.titulo = nombreServidor(o.sub.replace(/^plugin:[^:]+:/, '')); return o; }),
          'Todavía no vi servidores MCP de tu Claude Code. Aparecen después de la primera charla con un agente.'),
        fila('conectores', cx, rs[1].detectando ? 'Mirando tus conectores de claude.ai…' : 'No hay conectores detectados. Actualizá la lista en Ajustes › Conectores.'));
    });
  }

  /* ---------- carpetas de trabajo: donde los agentes trabajan (un repo, por ejemplo) y desde donde la app muestra ----------
     No es conocimiento: eso es la Biblioteca. Acá el agente lee y escribe, y el chat dibuja lo que deja ahí. */
  var TODA = '*oficina*';
  function quienesDe(c) {
    var al = c.alcance;
    if (!al || al === 'oficina') return 'Todos los agentes';
    var ags = (App.E.oficina && App.E.oficina.agentes) || [];
    var nom = function (id) { var a = ags.find(function (x) { return x.id === id; }); return a ? a.nombre : id; };
    if (al.agentes) return al.agentes.map(nom).join(', ');
    if (al.departamentos) {
      var ds = (App.E.oficina && App.E.oficina.departamentos) || [];
      return al.departamentos.map(function (id) { var d = ds.find(function (x) { return x.id === id; }); return d ? d.nombre : id; }).join(', ');
    }
    return '';
  }
  /* agrega una carpeta de trabajo (elige la persona, arrancando en `inicio`); devuelve la carpeta o null */
  App.agregarCarpetaTrabajo = function (inicio, alcance) {
    return App.elegirCarpeta('Carpeta de trabajo', { inicio: inicio, crear: true }).then(function (ruta) {
      if (!ruta) return null;
      return api().post('/api/carpetas-trabajo', { ruta: ruta, alcance: alcance || 'oficina' }).then(function (r) {
        return App.recargarOficina().then(function () {
          App.guardado('Los agentes ya pueden trabajar en ' + App.humano.carpeta(r.carpeta.ruta) + '.');
          return r.carpeta;
        });
      });
    }).catch(function (e) { App.fallo(e); return null; });
  };
  function carpetasTrabajo(crear) {
    var hj = crear({ titulo: 'Carpetas de trabajo' });
    var lista = h('div'), err = h('div.error-txt');
    App.add(hj.cuerpo,
      h('div.ayuda', { style: { marginTop: 0, marginBottom: '12px' } },
        'Carpetas de tu compu donde los agentes trabajan (un proyecto de código, por ejemplo) y desde donde la app te muestra lo que hacen: imágenes, páginas y archivos. No se suman a la Biblioteca.'),
      lista, err,
      h('div', { style: { marginTop: '12px' } }, h('button.btn', { onclick: function () { App.agregarCarpetaTrabajo().then(function (c) { if (c) pintar(); }); } }, App.icono('mas'), 'Agregar carpeta…')));
    function cambiar(c, valor) {
      var alcance = !valor.length || valor.indexOf(TODA) >= 0 ? 'oficina' : { agentes: valor };
      err.textContent = '';
      return api().patch('/api/carpetas-trabajo/' + encodeURIComponent(c.id), { alcance: alcance })
        .then(function () { return App.recargarOficina(); }).then(pintar)
        .catch(function (e) { err.textContent = e.message; pintar(); });
    }
    function quitar(c) {
      App.confirmar('¿Dejar de trabajar en esta carpeta?', 'Los agentes ya no van a poder leer ni escribir en ' + App.humano.carpeta(c.ruta) + '. La carpeta y sus archivos no se tocan.', 'Quitar', true).then(function (ok) {
        if (!ok) return;
        api().del('/api/carpetas-trabajo/' + encodeURIComponent(c.id)).then(function () { return App.recargarOficina(); }).then(pintar).catch(App.fallo);
      });
    }
    function fila(c) {
      var al = c.alcance, actual = al && al.agentes ? al.agentes.slice() : [TODA];
      var ags = (App.E.oficina && App.E.oficina.agentes) || [];
      var quien = App.elegir({ etiqueta: 'Quién trabaja ahí', forma: 'chips', multiple: true, valor: actual,
        opciones: [{ valor: TODA, titulo: 'Todos' }].concat(ags.map(function (a) { return { valor: a.id, titulo: a.nombre, retrato: a }; })),
        alCambiar: function (v) {
          // «Todos» y los agentes sueltos se excluyen: lo último que se tocó manda
          var nuevo = v.indexOf(TODA) >= 0 && actual.indexOf(TODA) < 0 ? [TODA] : v.filter(function (x) { return x !== TODA; });
          actual = nuevo.length ? nuevo : [TODA];
          quien.poner(actual);
          cambiar(c, actual);
        } });
      var falta = c.existe === false ? h('span', { style: { color: 'var(--peligro)' } }, ' · no se encuentra') : null;
      return h('div.ajuste', { style: { display: 'block' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          App.icono('carpeta'), h('div.ajuste-tit', { style: { flex: 1 }, title: c.ruta }, App.humano.carpeta(c.ruta), falta),
          App.nativo.hay ? h('button.btn.chico.fantasma', { title: 'Mostrar en el Finder', onclick: function () { App.nativo.revelar(c.ruta); } }, App.icono('abrir')) : null,
          h('button.btn.chico.fantasma', { onclick: function () { quitar(c); } }, 'Quitar')),
        h('div.ajuste-ayuda', { style: { margin: '6px 0' } }, al && al.departamentos ? 'Quién trabaja ahí: ' + quienesDe(c) : 'Quién trabaja ahí'),
        quien);
    }
    function pintar() {
      var cs = (App.E.oficina && App.E.oficina.carpetasTrabajo) || [];
      App.vaciar(lista);
      if (!cs.length) { lista.appendChild(h('div.vacio', 'Todavía no hay carpetas de trabajo. Los agentes trabajan solo dentro de la carpeta de la oficina.')); return; }
      api().get('/api/carpetas-trabajo').then(function (r) {
        App.vaciar(lista);
        (r.carpetas || []).forEach(function (c) { lista.appendChild(fila(c)); });
      }).catch(function (e) { err.textContent = e.message; });
    }
    pintar();
  }

  function avanzado(crear) {
    var hj = crear({ titulo: 'Avanzado' });
    function fila(titulo, bajada, boton, accion, peligro) {
      return App.ajuste(peligro ? h('span.txt-peligro', titulo) : titulo, bajada, h('button.btn.chico' + (peligro ? '.peligro' : ''), { onclick: accion }, boton));
    }
    App.add(hj.cuerpo,
      fila('Exportar oficina', 'Un archivo .zip para compartirla o pasarla a otra compu.', 'Exportar…', function () { App.exportarOficina(); }),
      fila('Borrar oficina', 'Se borran sus conversaciones y tareas, y su carpeta del disco (permanente).', 'Borrar…', function () { App.borrarOficina(); }, true));
  }

  /* Sección «Actualizar» (solo la versión web, GET/POST /api/actualizacion): trae lo último de la rama del clon
     (normalmente main), recompila y reinicia el servidor con actualizar.sh. Mientras tanto se pregunta cada 2 s; cuando
     vuelve con otro commit, se recarga la página. */
  function actualizarWeb(crear) {
    var vigilando = null;
    var hj = crear({ titulo: 'Actualizar', alCerrar: function () { clearTimeout(vigilando); vigilando = null; },
      acciones: h('button.btn.chico', { onclick: function () { if (!vigilando) cargar(); } }, App.icono('recargar'), 'Buscar de nuevo') });
    var err = h('div.error');
    function salida(txt) {
      return h('pre', { style: { font: '12px ui-monospace, Menlo, monospace', background: 'var(--panel-2)', border: '1px solid var(--linea)',
        borderRadius: 'var(--radio-chico)', padding: '8px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '240px', overflow: 'auto', margin: '6px 0 0' } }, txt);
    }
    function cargar() {
      App.vaciar(hj.cuerpo);
      hj.cuerpo.appendChild(App.cargando('Buscando cambios…'));
      api().get('/api/actualizacion').then(pintar).catch(function (e) {
        App.vaciar(hj.cuerpo);
        hj.cuerpo.appendChild(e.status === 404
          ? h('div.ayuda', { style: { marginTop: 0 } }, 'Esta instalación no se actualiza desde acá: el servidor no corre desde un clon del repo con actualizar.sh.')
          : h('div.error', e.message));
      });
    }
    function pintar(r) {
      App.vaciar(hj.cuerpo);
      var a = r.actual, nuevos = r.nuevos || [];
      App.add(hj.cuerpo,
        h('div.ayuda', { style: { marginTop: 0 } }, 'Trae lo último de la rama ' + (r.remoto || a.rama) + ', recompila y reinicia el servidor. La app de escritorio no se actualiza por acá: se actualiza sola con cada release.'),
        App.ajuste('Versión actual', a.version + ' · ' + a.rama + (a.fecha ? ' · ' + App.hace(a.fecha) : ''), null));
      if (r.corriendo) { esperar(a.commit); return; }
      if (r.error) hj.cuerpo.appendChild(h('div.error', r.error));
      var u = r.ultima;
      if (u && u.terminada && !u.ok) {
        App.add(hj.cuerpo, h('div.ajuste-tit', { style: { marginTop: '14px' } }, 'La última actualización falló (' + App.hace(u.terminada) + ')'), salida(u.salida));
      }
      if (r.cambiosLocales) {
        hj.cuerpo.appendChild(h('div.error', 'Hay cambios sin guardar en los archivos del repo de esta máquina: hay que guardarlos o descartarlos ahí antes de actualizar.'));
      }
      if (!nuevos.length) {
        if (!r.error) hj.cuerpo.appendChild(App.ajuste('Estás al día', 'No hay cambios nuevos en ' + (r.remoto || a.rama) + '.', null));
        return;
      }
      var lista = h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, nuevos.slice(0, 30).map(function (c) {
        return h('li', { style: { margin: '3px 0' } }, c.titulo, ' ', h('small', { style: { color: 'var(--suave)' } }, App.hace(c.fecha)));
      }));
      var boton = h('button.btn.primario', { disabled: !!r.cambiosLocales, onclick: function () { actualizar(r); } }, App.icono('bajar'), 'Actualizar ahora');
      App.add(hj.cuerpo,
        App.ajuste(nuevos.length === 1 ? '1 cambio nuevo' : nuevos.length + ' cambios nuevos', null, boton),
        lista, nuevos.length > 30 ? h('div.ayuda', 'y ' + (nuevos.length - 30) + ' más.') : null, err);
    }
    function actualizar(r) {
      var n = r.procesosVivos || 0;
      App.confirmar('Actualizar y reiniciar', (n ? 'Hay ' + (n === 1 ? 'un agente trabajando' : n + ' agentes trabajando') + ': se cortan al reiniciar. ' : '') +
        'El servidor se reinicia y la página se recarga sola cuando vuelve (tarda un par de minutos).', 'Actualizar').then(function (si) {
        if (!si) return;
        err.textContent = '';
        api().post('/api/actualizacion').then(function () { esperar(r.actual.commit); }).catch(function (e) { err.textContent = e.message; });
      });
    }
    /* se pregunta hasta que el servidor vuelve con otro commit (recarga), o el script termina sin cambiarlo (se muestra cómo) */
    function esperar(antes) {
      var desde = Date.now();
      App.vaciar(hj.cuerpo);
      var estado = h('div.ayuda', 'Bajando los cambios y compilando. Mientras se reinicia la página puede no responder un momento.');
      App.add(hj.cuerpo, App.cargando('Actualizando…'), estado);
      function otraVez() {
        if (!vigilando && vigilando !== 0) return;
        api().get('/api/actualizacion').then(function (r) {
          if (r.actual.commit !== antes) { estado.textContent = 'Listo: ' + r.actual.version + '. Recargando…'; location.reload(); return; }
          if (!r.corriendo) { vigilando = null; pintar(r); if (r.ultima && r.ultima.ok) App.aviso('El servidor se reinició.'); return; }
          seguir();
        }).catch(function () { estado.textContent = 'Reiniciando el servidor…'; seguir(); });
      }
      function seguir() {
        if (Date.now() - desde > 600000) { vigilando = null; cargar(); return; }
        vigilando = setTimeout(otraVez, 2000);
      }
      vigilando = 0;
      seguir();
    }
    cargar();
  }

  function permisos(crear) {
    if (App.Permisos.pintarModo) { App.Permisos.pintarModo(crear); return; }
    var hj = crear({ titulo: 'Permisos de los agentes' });
    App.add(hj.cuerpo,
      h('div.ayuda', { style: { marginTop: 0 } }, 'Vale para todas tus oficinas. Los agentes corren comandos y escriben archivos en tu compu: elegí cuánto querés que te pregunten.'),
      App.ajuste('Modo actual', modoPermisos() || 'Sin elegir',
        h('button.btn.chico', { onclick: function () { App.Permisos.abrirModo(function () { hj.cerrar(); }); } }, 'Cambiar…')));
  }

  function abrir(id) {
    if (!App.E.oficina) return;
    var actual = null, idActual = null;
    var hj = App.hoja({ titulo: 'Ajustes', ancho: 860, alto: '620px', sinPie: true, alCerrar: function () { soltar(); } });
    hj.el.classList.add('hoja-ajustes');
    var nav = h('nav.aj-nav');
    var tit = h('h3.aj-tit'), cuerpo = h('div.aj-cuerpo'), pie = h('div.aj-pie'), acc = h('div.aj-cab-acc');
    var atras = h('button.btn.fantasma.chico.aj-atras', { onclick: function () { caja.classList.remove('aj-dentro'); } }, App.icono('atras'), 'Ajustes');
    var sec = h('section.aj-sec', h('div.aj-cab', atras, tit, acc), cuerpo, pie);
    var caja = h('div.aj', nav, sec);
    hj.cuerpo.appendChild(caja);

    var visibles = SECCIONES.filter(function (s) { return !s.visible || s.visible(); });
    function grupo(g, titulo) {
      var ss = visibles.filter(function (s) { return s.grupo === g; });
      if (!ss.length) return;
      nav.appendChild(h('div.aj-grupo', titulo));
      ss.forEach(function (s) {
        var nota = s.nota ? s.nota() : '';
        nav.appendChild(h('button.aj-item', { 'data-id': s.id, title: s.texto, onclick: function () { ir(s.id); } }, App.icono(s.icono), h('span', s.texto),
          s.nota ? h('small', nota) : null, h('span.aj-flecha', App.icono('flecha'))));
      });
    }
    grupo('oficina', App.E.oficina.nombre);
    grupo('app', 'Toda la app');
    if (App.nativo.hay) App.add(nav, h('div', { style: { flex: 1 } }), h('button.aj-item.aj-tenue', { title: 'Acerca de', onclick: App.nativo.acerca }, App.icono('chispa'), h('span', 'Acerca de')));

    function soltar() { if (actual && actual.alCerrar) actual.alCerrar(); actual = null; }
    /* reemplazo de App.hoja para las secciones */
    function crear(op) {
      soltar();
      App.vaciar(cuerpo); App.vaciar(pie); App.vaciar(acc); cuerpo.scrollTop = 0;
      tit.textContent = op.titulo || '';
      if (op.acciones) App.add(acc, op.acciones);   // botones de la sección en su cabecera (p. ej. «Actualizar»)
      var obj = { enVentana: true, el: sec, cuerpo: cuerpo, pie: pie, alCerrar: op.alCerrar,
        titulo: function (t) { tit.textContent = t; },
        cerrar: function () { if (actual === obj) ir(idActual); } };
      actual = obj;
      return obj;
    }
    function ir(sid) {
      var s = visibles.filter(function (x) { return x.id === sid; })[0] || visibles[0];
      idActual = s.id;
      nav.querySelectorAll('.aj-item[data-id]').forEach(function (b) {
        b.classList.toggle('sel', b.getAttribute('data-id') === s.id);
        /* la nota (p. ej. el modo de permisos) puede haber cambiado desde otra hoja */
        var x = visibles.filter(function (y) { return y.id === b.getAttribute('data-id'); })[0], small = b.querySelector('small');
        if (x && x.nota && small) small.textContent = x.nota();
      });
      caja.classList.add('aj-dentro');
      s.pintar(crear);
      pie.classList.toggle('oculto', !pie.children.length);
    }
    /* en el celular, sin sección pedida, se arranca por la lista */
    var angosto = window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
    ir(id || 'general');
    if (angosto && !id) caja.classList.remove('aj-dentro');
  }

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === ',' && App.E.oficina && !(App.hojaAbierta && App.hojaAbierta())) { e.preventDefault(); abrir(); }
  });

  return { reglas: reglas, conectores: conectores, selector: selector, opcionesNombres: opcionesNombres, nuevosConectores: nuevosConectores, delTipo: delTipo, nombreServidor: nombreServidor, abrir: abrir, atajo: atajo };
})();
