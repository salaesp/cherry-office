/* Contratar: descripción -> borrador de Claude (o a mano) -> editar -> confirmar. Incluye el editor de agente
   (datos + avatar con retrato en vivo), que también usa la ficha del agente. */
(function () {
  'use strict';
  var h = App.h, api = App.api;
  /* Los modelos para elegir, una sola lista para toda la app (Ajustes › Modelos y la ficha de cada agente) */
  App.MODELOS = [
    { valor: 'sonnet', titulo: 'Sonnet', sub: 'Equilibrado: la mejor opción para casi todo.' },
    { valor: 'opus', titulo: 'Opus', sub: 'El más capaz, para trabajos difíciles. Gasta más.' },
    { valor: 'haiku', titulo: 'Haiku', sub: 'Rápido y barato, para cosas simples.' },
    { valor: 'inherit', titulo: 'El de Claude Code', sub: 'El que tengas elegido en tu Claude Code.' },
  ];
  /* Cuánto piensa antes de responder (`--effort`). Lo que piensa se cobra como texto escrito: más esfuerzo, más tokens.
     '' = el que tengas en tu Claude Code. Una sola lista: la ficha del agente, el selector de cada charla y las reuniones. */
  App.ESFUERZOS = [
    { valor: '', titulo: 'El de Claude Code', sub: 'El que tengas elegido en tu Claude Code.' },
    { valor: 'low', titulo: 'Bajo', sub: 'Responde rápido y gasta poco. Para charlas y pedidos simples.' },
    { valor: 'medium', titulo: 'Medio', sub: 'Piensa un poco. Buen equilibrio para el día a día.' },
    { valor: 'high', titulo: 'Alto', sub: 'Piensa más antes de responder. Gasta más.' },
    { valor: 'xhigh', titulo: 'Muy alto', sub: 'Para problemas difíciles. Gasta bastante más.' },
    { valor: 'max', titulo: 'Máximo', sub: 'Todo lo que pueda pensar. El que más gasta.' },
  ];
  /* orden del deslizador de modelo, de menos a más capaz y caro; el de Claude Code va como chip aparte */
  App.MODELO_ESCALA = ['haiku', 'sonnet', 'opus'];
  App.modeloOpciones = function () {
    var ord = App.MODELO_ESCALA.map(function (v) { return App.MODELOS.filter(function (m) { return m.valor === v; })[0]; });
    var resto = App.MODELOS.filter(function (m) { return App.MODELO_ESCALA.indexOf(m.valor) < 0; });
    return ord.concat(resto).map(function (m) {
      return { valor: m.valor, titulo: m.valor === 'inherit' ? 'Claude Code' : m.titulo, sub: m.sub, aparte: App.MODELO_ESCALA.indexOf(m.valor) < 0 };
    });
  };
  App.tituloModelo = function (v) { var m = App.MODELOS.filter(function (x) { return x.valor === v; })[0]; return m ? m.titulo : 'Sonnet'; };
  App.tituloEsfuerzo = function (v) { var m = App.ESFUERZOS.filter(function (x) { return x.valor === (v || ''); })[0]; return m ? m.titulo : ''; };

  /* Opciones de consumo que se pueden prender o apagar (Ajustes › Consumo de IA, cada charla y cada reunión nueva).
     Una sola lista, con lo que cuesta cada una, para que se entienda qué se gana al apagarla. */
  App.OPCIONES_IA = [
    { clave: 'skills', titulo: 'Skills de tu Claude Code', completo: 'completas',
      sub: 'Las skills y plugins que tenés instalados. En cada paso el agente recibe la lista: completa pesa varios miles de tokens. Cuáles puede usar cada oficina y cada agente se elige en Ajustes › Skills y MCP y en su ficha.',
      opciones: [
        { valor: 'resumidas', titulo: 'Todas, resumidas', sub: 'Puede usar cualquiera; la lista va con descripciones cortas. Menos de la mitad.' },
        { valor: 'completas', titulo: 'Todas, completas', sub: 'La lista entera, como Claude Code. La que más gasta.' },
        { valor: 'agente', titulo: 'Las de cada agente', sub: 'Solo las elegidas en la ficha de cada agente (o las de su oficina). Sin elegidas, ninguna.' },
        { valor: 'ninguna', titulo: 'Ninguna', sub: 'No usa skills.' }] },
    { clave: 'memoria', titulo: 'Memoria de la oficina', completo: 'completa',
      sub: 'Al empezar lee el contexto del negocio, las decisiones y el catálogo de documentos. Crecen con el uso: liviana ahorra, pero puede no tener presente alguna decisión.',
      opciones: [{ valor: 'completa', titulo: 'Leer al empezar' }, { valor: 'liviana', titulo: 'Solo si hace falta' }] },
    { clave: 'colegas', titulo: 'Consultar a colegas', completo: true,
      sub: 'Cada consulta es otro agente trabajando (hasta 3 por mensaje). Apagado, responde solo con lo suyo.',
      opciones: [{ valor: true, titulo: 'Puede' }, { valor: false, titulo: 'No puede' }] },
    { clave: 'mcpLocales', titulo: 'Servidores MCP de tu Claude Code', completo: true,
      sub: 'Los MCP que instalaste en Claude Code (no los conectores de claude.ai, que se asignan por agente). Cada uno suma sus herramientas en cada paso. Prendido, cada oficina y cada agente usan los que tengan habilitados.',
      opciones: [{ valor: true, titulo: 'Usarlos' }, { valor: false, titulo: 'Solo los de la oficina' }] },
  ];
  /* lo de Ajustes › Consumo de IA, con los valores de siempre si todavía no llegó el estado */
  App.iaApp = function () { return Object.assign({ esfuerzo: '', skills: 'resumidas', memoria: 'completa', colegas: true, mcpLocales: true }, (App.E.estado && App.E.estado.ia) || {}); };
  App.opcionIA = function (clave) { return App.OPCIONES_IA.filter(function (o) { return o.clave === clave; })[0]; };
  App.tituloOpcionIA = function (o, v) { var x = o.opciones.filter(function (y) { return y.valor === v; })[0]; return x ? x.titulo : String(v); };

  /* opciones de consumo con más de dos valores: su orden en el deslizador, de menos a más tokens */
  App.ESCALAS_IA = { skills: ['ninguna', 'agente', 'resumidas', 'completas'] };
  /* El control de una opción de consumo: deslizador si tiene escala, interruptor si es de sí o no, chips si no */
  App.controlOpcionIA = function (o, valor, alCambiar) {
    var escala = App.ESCALAS_IA[o.clave];
    var opciones = escala ? escala.map(function (v) { return o.opciones.filter(function (x) { return x.valor === v; })[0]; }) : o.opciones;
    return App.elegir({ forma: escala ? 'deslizador' : o.opciones.length === 2 ? 'interruptor' : 'chips', etiqueta: o.titulo, valor: valor,
      opciones: opciones.map(function (x) { return { valor: x.valor, titulo: x.titulo, sub: x.sub }; }), alCambiar: alCambiar });
  };

  /* Ahorro de tokens en un solo control: tres niveles que fijan todas las opciones de consumo juntas. Si se eligió cada
     una por separado y no coincide con ningún nivel, es «A medida». Lo usan Ajustes › Consumo de IA y cada charla. */
  App.AHORROS = [
    { valor: 'nada', titulo: 'Nada', sub: 'Skills completas, lee la memoria, consulta a colegas y usa tus MCP. El que más gasta.',
      ia: { skills: 'completas', memoria: 'completa', colegas: true, mcpLocales: true } },
    { valor: 'algo', titulo: 'Algo', sub: 'Igual que «Nada», pero la lista de skills va resumida. Gasta bastante menos y casi no se nota.',
      ia: { skills: 'resumidas', memoria: 'completa', colegas: true, mcpLocales: true } },
    { valor: 'mucho', titulo: 'Mucho', sub: 'Solo las skills de cada agente, la memoria si hace falta, sin colegas ni tus MCP. Responde con lo suyo.',
      ia: { skills: 'agente', memoria: 'liviana', colegas: false, mcpLocales: false } },
  ];
  App.AHORRO_MEDIDA = { valor: 'medida', titulo: 'A medida', sub: 'Elegiste cada opción por separado.', aparte: true };
  App.ahorroDe = function (e) {
    var n = App.AHORROS.filter(function (a) { return Object.keys(a.ia).every(function (k) { return e[k] === a.ia[k]; }); })[0];
    return n ? n.valor : 'medida';
  };
  App.tituloAhorro = function (v) { var a = App.AHORROS.filter(function (x) { return x.valor === v; })[0]; return a ? a.titulo : App.AHORRO_MEDIDA.titulo; };
  App.controlAhorro = function (valor, alCambiar) {
    var el = App.elegir({ forma: 'deslizador', etiqueta: 'Ahorro de tokens', valor: valor,
      opciones: App.AHORROS.map(function (a) { return { valor: a.valor, titulo: a.titulo, sub: a.sub }; }).concat([App.AHORRO_MEDIDA]), alCambiar: alCambiar });
    el.classList.add('elegir-ahorro');
    return el;
  };

  /* Selector de una charla (como en Claude): un botón chico que abre un panel con modelo (chips), esfuerzo y ahorro
     (deslizadores) y, plegado, cada opción de consumo. Pisa lo del agente y lo de Ajustes solo en esa charla.
     op: {modelo, esfuerzo (los del agente), valor (lo elegido antes), soloModelo (sin opciones: el Creador), alCambiar(v)}.
     .valor() devuelve solo lo que difiere de lo de por defecto. */
  App.SelectorCharla = function (op) {
    var v = Object.assign({}, op.valor || {});
    var b = h('button.btn.chico.fantasma.selector-charla', { type: 'button', title: 'Modelo, esfuerzo y ahorro de esta charla' });
    function defecto() {
      var ia = App.iaApp();
      return { modelo: op.modelo || 'sonnet', esfuerzo: op.esfuerzo || ia.esfuerzo || '', skills: ia.skills, memoria: ia.memoria, colegas: ia.colegas, mcpLocales: ia.mcpLocales };
    }
    function efectivo() { return Object.assign(defecto(), v); }
    function pintar() {
      var e = efectivo(), ah = op.soloModelo ? null : App.ahorroDe(e);
      App.vaciar(b);
      App.add(b, App.icono('deslizadores'), h('span', App.tituloModelo(e.modelo) + (e.esfuerzo ? ' · ' + App.tituloEsfuerzo(e.esfuerzo) : '') +
        (ah && ah !== 'algo' ? ' · Ahorro: ' + App.tituloAhorro(ah).toLowerCase() : '')));
      b.classList.toggle('cambiado', Object.keys(v).length > 0);
    }
    function cambiar(cambios) {
      var d = defecto();
      Object.keys(cambios).forEach(function (k) { if (cambios[k] === d[k]) delete v[k]; else v[k] = cambios[k]; });
      pintar();
      if (op.alCambiar) op.alCambiar(b.valor());
    }
    function uno(k, val) { var c = {}; c[k] = val; cambiar(c); }

    function contenido(caja) {
      App.vaciar(caja);
      var e = efectivo(), d = defecto();
      var subModelo = h('div.pc-nota');   // el deslizador ya muestra qué hace cada modelo; acá solo el default del agente
      function notaModelo(m) {
        subModelo.textContent = m !== d.modelo ? 'El de este agente es ' + App.tituloModelo(d.modelo) + '.' : '';
      }
      var modelo = App.elegir({ forma: 'deslizador', etiqueta: 'Modelo', valor: e.modelo,
        opciones: App.modeloOpciones(),
        alCambiar: function (m) { uno('modelo', m); notaModelo(m); pintarPie(); } });
      notaModelo(e.modelo);
      var esfuerzo = App.elegir({ forma: 'deslizador', etiqueta: 'Esfuerzo', valor: e.esfuerzo,
        opciones: App.ESFUERZOS.map(function (m) { return { valor: m.valor, titulo: m.valor ? m.titulo : 'El de Claude Code', sub: m.sub, aparte: m.valor === '' }; }),
        alCambiar: function (x) { uno('esfuerzo', x); pintarPie(); } });
      App.add(caja,
        h('div.pc-sec', h('div.pc-tit', 'Modelo'), modelo, subModelo),
        h('div.pc-sec', h('div.pc-tit', 'Esfuerzo', h('span', 'cuánto piensa antes de responder')), esfuerzo));

      if (!op.soloModelo) {
        var controles = [];
        var detalle = h('details.avanzado.pc-detalle', h('summary', 'Cada opción'));
        var ahorro = App.controlAhorro(App.ahorroDe(e), function (a) {
          var nivel = App.AHORROS.filter(function (x) { return x.valor === a; })[0];
          if (nivel) cambiar(nivel.ia); else detalle.open = true;   // «A medida» abre el detalle
          sincronizar();
        });
        function sincronizar() {
          var e2 = efectivo();
          ahorro.poner(App.ahorroDe(e2));
          controles.forEach(function (c) { c.el.poner(e2[c.clave]); });
          pintarPie();
        }
        App.OPCIONES_IA.forEach(function (o) {
          if (o.soloAjustes) return;
          var el = App.controlOpcionIA(o, e[o.clave], function (x) { uno(o.clave, x); sincronizar(); });
          controles.push({ clave: o.clave, el: el });
          detalle.appendChild(h('div.pc-fila', h('div.pc-fila-tit', { title: o.sub }, o.titulo), el));
        });
        if (App.ahorroDe(e) === 'medida') detalle.open = true;
        detalle.addEventListener('toggle', reubicar);
        App.add(caja, h('div.pc-sec', h('div.pc-tit', 'Ahorro de tokens', h('span', 'lo que lee y usa en cada paso')), ahorro, detalle));
      }

      var restablecer = h('button.btn.chico.fantasma', { type: 'button', onclick: function () {
        v = {}; pintar(); if (op.alCambiar) op.alCambiar(b.valor()); contenido(caja); reubicar();
      } }, 'Volver a lo de siempre');
      function pintarPie() { restablecer.disabled = !Object.keys(v).length; }
      pintarPie();
      App.add(caja, h('div.pc-pie', restablecer,
        op.soloModelo ? null : h('button.btn.chico.fantasma', { type: 'button', title: 'Lo de siempre, para todas las charlas',
          onclick: function () { if (panel) panel.cerrar(); App.Ajustes.abrir('ia'); } }, 'Ajustes › Modelos y consumo')));
    }

    var panel = null;
    /* al abrir «Cada opción» el panel crece: si está arriba del botón, sube para no taparlo ni salirse de la pantalla */
    function reubicar() {
      var el = b._panel && b._panel.parentNode;
      if (!el || !el.isConnected) return;
      var r = b.getBoundingClientRect(), hh = el.offsetHeight;
      var y = r.bottom + 6;
      if (y + hh > window.innerHeight - 8) y = Math.max(8, r.top - hh - 6);
      el.style.top = y + 'px';
    }
    b.addEventListener('click', function () {
      var caja = h('div.pc-cuerpo');
      contenido(caja);
      b._panel = caja;
      panel = App.emergente(b, caja, 'panel-charla');
    });
    b.valor = function () { return Object.assign({}, v); };
    pintar();
    return b;
  };

  /* ---------------- editor de apariencia (agentes y tu perfil): el pixel de pixel/avatar.js ----------------
     avatar: objeto inicial; semilla(): de dónde salen los valores que falten. Devuelve {el, valor(), retratar()}. */
  App.EditorAvatar = App.Pixel.editor;


  /* ---------------- editor ---------------- */
  /* «a, b, c» -> ["a", "b", "c"] sin vacíos ni repetidos (sin importar acentos ni mayúsculas) */
  function temas(texto) {
    var vistos = {}, out = [];
    String(texto || '').split(/[,;\n]/).forEach(function (t) {
      t = t.trim(); if (!t) return;
      var n = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (vistos[n]) return; vistos[n] = true; out.push(t);
    });
    return out;
  }
  App.temas = temas;

  /* chips de temas: lo que se pega separado por comas se parte en varios (sin repetidos) */
  function chipsTemas(items, op) {
    var caja = App.chipsEditables(items, Object.assign({}, op, { alCambiar: function (lista, c) {
      if (c && c.agregado && /[,;\n]/.test(c.agregado)) {
        lista.splice(lista.indexOf(c.agregado), 1);
        temas(lista.concat(c.agregado.split(/[,;\n]/))).forEach(function (t) { if (lista.indexOf(t) < 0) lista.push(t); });
        caja.repintar();
      }
    } }));
    return caja;
  }

  App.EditorAgente = function (dato, op) {
    op = op || {};
    var d = JSON.parse(JSON.stringify(dato || {}));
    d.avatar = d.avatar || { semilla: d.id || App.uuid().slice(0, 8) };
    var usados = App.E.oficina.agentes.map(function (a) { return a.id; });
    var idTocado = !!op.editar;
    /* la ayuda va antes del campo, como bajada de la etiqueta */
    function campo(etq, el, ayuda) { return h('div.fila-campo', h('label.etiqueta-campo', etq), ayuda ? h('div.ayuda', ayuda) : null, el); }
    function grupo(titulo, hijos) { return h('section.ficha-grupo', h('h4.ficha-grupo-tit', titulo), hijos); }
    var deptos = App.E.oficina.departamentos;
    var nombre = h('input.campo', { value: d.nombre || '', maxlength: 80, placeholder: 'Ej.: Lu' });
    var id = h('input.campo.chico.ficha-id-campo', { value: d.id || '', maxlength: 41, spellcheck: 'false' });
    var rol = h('input.campo', { value: d.rol || '', maxlength: 160, placeholder: 'Ej.: Analista de ventas' });
    var dep = App.elegir({ etiqueta: 'Departamento', valor: d.departamento || (deptos[0] && deptos[0].id),
      opciones: deptos.map(function (x) { return { valor: x.id, titulo: x.nombre, color: x.color }; }) });
    /* mismos deslizadores que en el selector de cada charla */
    var modelo = App.elegir({ etiqueta: 'Modelo', forma: 'deslizador', valor: d.modelo || 'sonnet',
      opciones: App.modeloOpciones() });
    var esfuerzo = App.elegir({ etiqueta: 'Esfuerzo', forma: 'deslizador', valor: d.esfuerzo || '',
      opciones: App.ESFUERZOS.map(function (m) { return { valor: m.valor, titulo: m.valor ? m.titulo : 'El de Claude Code', sub: m.sub, aparte: m.valor === '' }; }) });
    var desc = h('input.campo', { value: d.description || '', maxlength: 1000, placeholder: 'En una línea, para qué sirve' });
    var prompt = h('textarea.campo', { rows: 9, maxlength: 20000 }); prompt.value = d.prompt || '';
    var sabeItems = temas((d.sabeDe || []).join(', '));
    var sabe = chipsTemas(sabeItems, { placeholder: 'Un tema, por ejemplo: Reels', max: 12, largo: 60 });
    var chipsItems = (d.chips || []).filter(Boolean).slice(0, 3);
    var pedidos = App.chipsEditables(chipsItems, { placeholder: 'Un pedido de ejemplo', max: 3, largo: 200 });
    var ava = App.EditorAvatar(d.avatar, function () { return d.avatar.semilla || id.value; }, { plegable: true });
    if (!op.editar) nombre.addEventListener('input', function () { if (!idTocado) id.value = App.slug(nombre.value, usados); ava.retratar(); });
    id.addEventListener('input', function () { idTocado = true; });
    /* el identificador es un dato técnico: texto chico y secundario (editable solo al contratar) */
    var idFila = op.editar
      ? h('div.ficha-id', 'Identificador: ', h('code', d.id || ''), ' · no se puede cambiar')
      : h('div.ficha-id', h('label', 'Identificador'), id, h('span', 'Así se llama el agente en Claude Code.'));

    var el = h('div.editor',
      ava.el,
      h('div',
        grupo('Quién es', [
          campo('Nombre', nombre),
          campo('Rol', rol),
          campo('Departamento', dep, 'La sala de la oficina donde trabaja.'),
          campo('Descripción corta', desc)]),
        grupo('Cómo trabaja', [
          campo('Instrucciones', prompt, 'Cómo trabaja, qué entrega y cómo habla. Es el texto que recibe Claude.'),
          campo('Modelo', modelo, 'Cambia cuánto gasta y qué tan bien resuelve. Vale desde la próxima vez que trabaje.'),
          campo('Esfuerzo', esfuerzo, 'Cuánto piensa antes de responder. Pensar también gasta tokens: para charlar, Bajo o Medio alcanza. En cada charla lo podés cambiar.'),
          campo('Sabe de', sabe, 'Hasta 12 temas. Sus colegas los usan para saber a quién preguntarle.'),
          campo('Pedidos sugeridos', pedidos, 'Hasta 3 frases que aparecen como botones al abrir su charla.')]),
        idFila));

    return {
      el: el,
      valor: function () {
        return {
          id: id.value.trim() || d.id || '', nombre: nombre.value.trim(), rol: rol.value.trim(), departamento: dep.valor() || '', modelo: modelo.valor(), esfuerzo: esfuerzo.valor() || '',
          description: desc.value.trim() || rol.value.trim(), prompt: prompt.value.trim(),
          chips: chipsItems.map(function (c) { return c.trim(); }).filter(Boolean), avatar: ava.valor(), brief: d.brief || undefined,
          sabeDe: sabeItems.slice()
        };
      },
      validar: function () {
        var v = this.valor();
        if (!v.nombre) return 'Falta el nombre.';
        if (!v.rol) return 'Falta el rol.';
        if (!v.prompt) return 'Faltan las instrucciones.';
        if (!op.editar && !/^[a-z0-9][a-z0-9-]{0,40}$/.test(v.id)) return 'El identificador va en minúsculas, números y guiones.';
        if (!op.editar && usados.indexOf(v.id) >= 0) return 'Ya hay un agente con ese identificador.';
        if (!v.departamento) return 'Elegí un departamento (creá uno en Departamentos).';
        if (v.sabeDe.length > 12) return '«Sabe de» admite hasta 12 temas.';
        if (v.sabeDe.some(function (t) { return t.length > 60; })) return 'Cada tema de «Sabe de» tiene que tener hasta 60 caracteres.';
        return null;
      }
    };
  };

  /* ---------------- flujo de contratación ----------------
     Es una pantalla (#/equipo/contratar): primero se cuenta qué hace falta y después se revisa el perfil, en el mismo lugar. */
  App.Contratar = {
    abrir: function (op) {
      op = op || {};
      if (!App.E.oficina.departamentos.length) { App.aviso('Primero creá un departamento.', true); App.Nav.ir('#/equipo/departamentos'); return; }
      var hj = App.hojaEnPanel({ titulo: 'Contratar', icono: 'personas' }, 'contratar');
      var desc = h('textarea.campo', { rows: 5, autofocus: true, maxlength: 4000, placeholder: 'Ej.: alguien que mire las ventas de cada semana, me diga qué productos se mueven y arme un resumen corto para el lunes.' });
      var deptos = App.E.oficina.departamentos;
      var dep = App.elegir({ etiqueta: 'Departamento', valor: op.departamento || deptos[0].id,
        opciones: deptos.map(function (x) { return { valor: x.id, titulo: x.nombre, color: x.color }; }) });
      var err = h('div.error-txt'), estado = h('div');
      var pedir = h('button.btn.primario', { onclick: borrador }, App.icono('chispa'), 'Proponer con Claude');
      App.add(hj.cuerpo,
        h('p', { style: { color: 'var(--suave)', marginTop: '4px', marginBottom: '14px' } }, 'Contá con tus palabras qué necesitás. Claude arma el perfil del agente y lo revisás antes de contratarlo.'),
        h('div.fila-campo', h('label.etiqueta-campo', '¿Qué tiene que hacer?'), desc),
        h('div.fila-campo', h('label.etiqueta-campo', 'Departamento'), h('div.ayuda', 'Dónde se sienta en la oficina.'), dep), estado, err);
      App.add(hj.pie, App.acciones(
        [h('button.btn.fantasma', { onclick: function () { paso2({ departamento: dep.valor(), brief: desc.value.trim() }); } }, 'Completar a mano')],
        [h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), pedir]));
      function borrador() {
        err.textContent = '';
        if (desc.value.trim().length < 8) { err.textContent = 'Contá un poco más qué necesitás.'; desc.focus(); return; }
        pedir.disabled = true; App.add(App.vaciar(estado), App.cargando('Claude está armando el perfil… puede tardar unos segundos.'));
        api.post('/api/agentes/borrador', { descripcion: desc.value.trim(), departamento: dep.valor() })
          .then(function (b) { b.brief = desc.value.trim(); b.departamento = b.departamento || dep.valor(); paso2(b); })
          .catch(function (e) { err.textContent = e.message; pedir.disabled = false; App.vaciar(estado); });
      }
      function paso2(datos) {
        hj.titulo('Revisá el perfil');
        var ed = App.EditorAgente(datos, {});
        var err2 = h('div.error-txt');
        App.add(App.vaciar(hj.cuerpo), h('p', { style: { color: 'var(--suave)', marginTop: '4px', marginBottom: '14px' } }, 'Cambiá lo que quieras: después se puede editar en su ficha.'), ed.el, err2);
        var ok = h('button.btn.primario', {
          onclick: function () {
            var m = ed.validar(); if (m) { err2.textContent = m; return; }
            ok.disabled = true; ok.textContent = 'Contratando…';
            api.post('/api/agentes', ed.valor()).then(function (r) {
              hj.cerrar();
              App.actualizar(r.oficina);
              App.aviso(r.agente.nombre + ' ya está en la oficina.');
              setTimeout(function () { App.Agente.abrir(r.agente.id); }, 400);
            }).catch(function (e) { err2.textContent = e.message; ok.disabled = false; ok.textContent = 'Contratar'; });
          }
        }, 'Contratar');
        App.add(App.vaciar(hj.pie), App.acciones(null, [h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), ok]));
      }
    }
  };
})();
