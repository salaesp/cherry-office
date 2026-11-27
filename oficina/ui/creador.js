/* La pantalla de armar la oficina (#/equipo/creador): el borrador de tarjetas a la derecha y, a la izquierda, a quién se le
   pide. Con secretaría (toda oficina nueva la trae, docs/plan-secretaria-creadora.md) es «Propuestas»: la izquierda la
   presenta y lo que le escribís va a su charla; las tarjetas son las que ella propone. Sin secretaría (oficinas de antes)
   sigue el chat con el Creador, con un aviso para contratarla.
   Nada se crea hasta que la persona lo aprueba con el botón del pie. Las tarjetas se editan en el lugar. */
window.App = window.App || {};
(function () {
  'use strict';
  var h = App.h, api = App.api;

  var TIPOS = ['departamento', 'agente', 'regla', 'conector', 'flujo', 'tarea'];
  var TIPO_TXT = { departamento: 'Departamentos', agente: 'Agentes', regla: 'Reglas', conector: 'Conectores', flujo: 'Flujos', tarea: 'Tareas' };
  var TIPO_UNO = { departamento: 'Departamento', agente: 'Agente', regla: 'Regla', conector: 'Conector', flujo: 'Flujo', tarea: 'Tarea' };
  var TIPO_ICONO = { departamento: 'edificio', agente: 'personas', regla: 'regla', conector: 'enchufe', flujo: 'flujo', tarea: 'recargar' };
  var ACCION_TXT = { crear: 'Nuevo', modificar: 'Cambio', quitar: 'Quitar' };
  var ESTADO_TXT = { borrador: 'Borrador', lista: 'Lista', creada: 'Creada', error: 'Error' };
  var DIAS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [7, 'Dom']];
  var MODELOS = [['', 'El de siempre'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']];
  var ZONA_BASE = 'America/Argentina/Buenos_Aires';
  var INTRO = 'Contame qué hace tu negocio y cómo querés organizar el equipo. Voy armando tarjetas a la derecha: nada se crea hasta que lo apruebes.';
  var abierta = null;   // la pantalla abierta (una sola a la vez)
  var alActividadActual = null;
  App.on('actividad', function (r) { if (alActividadActual) alActividadActual(r); });

  function buscar(lista, f) { for (var i = 0; i < (lista || []).length; i++) if (f(lista[i])) return lista[i]; return null; }
  function recortar(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

  /* un uuid por oficina, guardado en el navegador (si no se puede, vale solo hasta cerrar) */
  function sesionDe() {
    var k = 'creador-sesion:' + (App.E.carpeta || '');
    try {
      var v = localStorage.getItem(k);
      if (v) return v;
      v = App.uuid(); localStorage.setItem(k, v); return v;
    } catch (e) { return App.uuid(); }
  }

  /* ---------------- nombres y valores legibles ---------------- */
  var tarjetasActuales = [];
  function tarjetaPorId(id) { return buscar(tarjetasActuales, function (t) { return t.id === id; }); }
  function tituloTarjeta(t) {
    var d = t.datos || {};
    if (t.tipo === 'regla') return recortar(d.texto || 'Regla sin texto', 70);
    if (t.tipo === 'conector') return (d.servidor || 'Conector') + (d.agente ? ' · ' + nombreDe('agente', d.agente) : '');
    if (t.tipo === 'tarea' && d.nombre) return d.nombre;
    return d.nombre || (t.objetivo ? nombreDe(t.tipo, t.objetivo) : '') || ('Sin nombre');
  }
  /* una referencia puede ser un id existente, «tarjeta:x» o «persona» */
  function nombreDe(tipo, ref) {
    if (ref === undefined || ref === null || ref === '') return '';
    ref = String(ref);
    if (ref === 'persona') return 'Vos';
    if (ref.indexOf('tarjeta:') === 0) {
      var t = tarjetaPorId(ref.slice(8));
      return t ? tituloTarjeta(t) + ' (propuesta)' : '(ya no está)';
    }
    var o = App.E.oficina || {};
    if (tipo === 'departamento') { var d = App.depto(ref); return d ? d.nombre : '(ya no está)'; }
    if (tipo === 'agente') return App.humano.quien(ref) === 'alguien que ya no está' ? '(ya no está)' : App.humano.quien(ref);
    if (tipo === 'flujo') { var f = buscar(o.flujos, function (x) { return x.id === ref; }); return f ? f.nombre : '(ya no está)'; }
    if (tipo === 'regla') { var r = buscar(o.reglas, function (x) { return x.id === ref; }); return r ? recortar(r.texto, 70) : '(ya no está)'; }
    return ref;
  }
  /* un valor suelto (texto, lista u objeto) en palabras, sin JSON */
  function suelto(x) {
    if (x === null || x === undefined) return '';
    if (typeof x === 'boolean') return x ? 'Sí' : 'No';
    if (typeof x !== 'object') return String(x);
    if (Array.isArray(x)) return x.map(suelto).filter(Boolean).join(', ');
    var cab = x.nombre || x.texto || x.servidor || x.titulo || x.pregunta;
    if (cab) return String(cab);
    return Object.keys(x).map(function (k) { return suelto(x[k]); }).filter(Boolean).join(' · ');
  }
  function listaTxt(l) { return (l || []).map(suelto).join('; '); }
  function limitesTxt(l) {
    if (!l) return '';
    var p = [];
    if (l.solo && l.solo.length) p.push('Hace solo: ' + listaTxt(l.solo));
    if (l.proponer && l.proponer.length) p.push('Propone y espera: ' + listaTxt(l.proponer));
    return p.join(' · ');
  }
  /* el valor de un campo, en texto, para «Antes → Ahora» */
  function valorTxt(clave, v) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (clave === 'departamento' || clave === 'agente') return nombreDe(clave, v);
    if (clave === 'permisos') return (v || []).indexOf('coordinador') >= 0 ? 'Es coordinador/a' : '—';
    if (clave === 'limites') return limitesTxt(v) || '—';
    if (clave === 'conectores') return v.map(function (c) { return c.servidor; }).join(', ');
    if (clave === 'pasos') return v.map(function (p) { return p.nombre + (p.quien ? ' (' + nombreDe('agente', p.quien) + ')' : ''); }).join(' → ');
    if (clave === 'dias') return v.map(function (n) { return (buscar(DIAS, function (d) { return d[0] === n; }) || [0, n])[1]; }).join(', ');
    if (Array.isArray(v)) return listaTxt(v);
    return suelto(v);
  }
  var ETIQUETAS = { nombre: 'Nombre', mision: 'Misión', color: 'Color', rol: 'Rol', departamento: 'Departamento', prompt: 'Instrucciones', description: 'Descripción',
    modelo: 'Modelo', chips: 'Atajos', limites: 'Límites', conectores: 'Conectores', permisos: 'Coordinación', descripcion: 'Descripción', pasos: 'Pasos',
    texto: 'Texto', agente: 'Agente', servidor: 'Conector', leer: 'Puede leer', actuar: 'Puede hacer', consigna: 'Consigna', dias: 'Días', hora: 'Hora', zona: 'Zona', fecha: 'Fecha' };

  /* lo que hay hoy en oficina.json para la tarjeta de modificar */
  function actualDe(t) {
    var o = App.E.oficina || {}, obj = t.objetivo;
    if (!obj && t.tipo !== 'conector') return null;
    if (t.tipo === 'departamento') return App.depto(obj);
    if (t.tipo === 'agente') return App.agente(obj);
    if (t.tipo === 'flujo') return buscar(o.flujos, function (x) { return x.id === obj; });
    if (t.tipo === 'regla') return buscar(o.reglas, function (x) { return x.id === obj; });
    if (t.tipo === 'conector') {
      var a = App.agente((t.datos || {}).agente || obj);
      var c = a ? buscar(a.conectores, function (x) { return x.servidor === (t.datos || {}).servidor; }) : null;
      return c;
    }
    return null;
  }
  function diferencias(t) {
    var antes = actualDe(t), d = t.datos || {}, out = [];
    if (!antes) return out;
    Object.keys(d).forEach(function (k) {
      if (k === 'id') return;
      var a = valorTxt(k, antes[k]), b = valorTxt(k, d[k]);
      if (a !== b) out.push({ etq: ETIQUETAS[k] || k, antes: a, ahora: b });
    });
    return out;
  }

  /* ---------------- tarjeta ---------------- */
  function fila(etq, contenido) {
    if (contenido === null || contenido === undefined || contenido === false || contenido === '') return null;
    return h('div.tb-fila', h('b', etq), h('div', contenido));
  }
  function itemsCortos(items, max) {
    items = items || [];
    if (!items.length) return null;
    var ul = h('ul.tb-lista', items.slice(0, max).map(function (x) { return h('li', x); }));
    if (items.length > max) ul.appendChild(h('li.tb-mas', 'y ' + (items.length - max) + ' más'));
    return ul;
  }
  function camposClave(t) {
    var d = t.datos || {};
    if (t.tipo === 'departamento') return [fila('Misión', d.mision)];
    if (t.tipo === 'agente') {
      var l = d.limites || {}, cons = (d.conectores || []).map(function (c) { return c.servidor; });
      return [
        fila('Rol', d.rol),
        fila('Departamento', d.departamento ? nombreDe('departamento', d.departamento) : null),
        fila('Hace solo', itemsCortos(l.solo, 3)),
        fila('Propone y espera', itemsCortos(l.proponer, 3)),
        fila('Conectores', cons.length ? cons.join(', ') : null),
        (d.permisos || []).indexOf('coordinador') >= 0 ? fila('Coordinación', h('span.insignia.ok', 'Es coordinador/a')) : null
      ];
    }
    if (t.tipo === 'flujo') {
      var pasos = d.pasos || [];
      return [fila('Qué es', d.descripcion), pasos.length ? h('ol.tb-pasos', pasos.map(function (p, i) {
        return h('li', h('span.tb-paso-n', String(i + 1)),
          h('span.tb-paso-t', h('b', p.nombre || 'Paso sin nombre'), p.quien ? h('span.ayuda', ' · ' + nombreDe('agente', p.quien)) : null),
          p.aprobacion === true ? h('span.insignia.ok', 'Pide aprobación') : p.aprobacion === false ? h('span.insignia', 'Sin aprobación') : h('span.insignia.aviso', 'Aprobación sin definir'));
      })) : h('div.ayuda', 'Todavía no tiene pasos.')];
    }
    if (t.tipo === 'regla') return [];
    if (t.tipo === 'conector') return [fila('Agente', d.agente ? nombreDe('agente', d.agente) : null), fila('Puede leer', itemsCortos(d.leer, 4)), fila('Puede hacer', itemsCortos(d.actuar, 4))];
    if (t.tipo === 'tarea') return [fila('Agente', d.agente ? nombreDe('agente', d.agente) : null), fila('Consigna', d.consigna),
      fila('Cuándo', [d.dias ? valorTxt('dias', d.dias) : '', d.hora || '', d.zona || ''].filter(Boolean).join(' · '))];
    return [];
  }

  /* ---------------- pantalla ---------------- */
  function abrir() {
    /* si otra pantalla ya reemplazó a la del Creador, la anterior no cuenta como abierta */
    if (abierta && abierta.el.isConnected) { try { abierta.el.scrollIntoView(); } catch (e) {} return; }
    var sid = sesionDe();
    var cerrada = false, relojChat = null, versionVista = -1, mensajes = [], corriendo = false, enviando = false;
    var tarjetas = [], resumen = {}, filtro = '', excluidas = {}, aplicando = false, erroresAplicar = [];
    var editando = {};   // id de tarjeta → formulario en el lugar (se conserva aunque el borrador se repinte)

    var sec = App.secretaria ? App.secretaria() : null;
    var hj = App.hojaEnPanel({ titulo: sec ? 'Propuestas' : 'Armar con el Creador', icono: 'chispa', sinPie: true, alCerrar: function () {
      cerrada = true; clearTimeout(relojChat); abierta = null; alActividadActual = null;
    } }, 'creador');
    abierta = hj;
    hj.cuerpo.classList.add('creador-cuerpo');
    function viva() {
      if (cerrada) return false;
      if (!hj.el.isConnected) { cerrada = true; clearTimeout(relojChat); abierta = null; alActividadActual = null; return false; }
      return true;
    }

    /* ---- izquierda: chat ---- */
    var lista = h('div.chat'), cuerpoChat = h('div.creador-chat-cuerpo', lista);
    var txt = h('textarea.campo', { rows: 2, maxlength: 60000, placeholder: 'Pegá el texto completo de cómo querés tu oficina, o contame de a poco' });
    var enviar = h('button.btn.primario.icono', { title: 'Enviar (Cmd/Ctrl+Enter)', onclick: mandar }, App.icono('enviar'));
    /* modelo y esfuerzo de esta charla con el Creador (por defecto, el de Ajustes › Modelos) */
    var selector = App.SelectorCharla({ soloModelo: true, modelo: (App.E.estado && App.E.estado.modelos && App.E.estado.modelos.creador) || 'sonnet' });
    txt.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); mandar(); } });
    txt.addEventListener('input', function () { txt.style.height = 'auto'; txt.style.height = Math.min(180, txt.scrollHeight + 2) + 'px'; });
    var colChat;
    if (sec) {
      /* con secretaría: lo que le escribís va a su charla (y la abre); las tarjetas que propone aparecen acá */
      txt.placeholder = 'Pedile algo a ' + sec.nombre + ': «contratá a alguien que…», «armemos un flujo para…», o pegá cómo trabajás';
      enviar.title = 'Mandárselo a ' + sec.nombre + ' (Cmd/Ctrl+Enter)';
      colChat = h('div.creador-col.creador-chat.creador-sec',
        h('div.creador-sec-cuerpo', App.retratoImg(sec, 'creador-sec-cara', 192),
          h('b', sec.nombre), h('span.ayuda', 'Secretaría'),
          h('p', 'Para crear o cambiar algo en la oficina, pedíselo a ' + sec.nombre + ': contratar a alguien, un departamento, una tarea, un flujo, una regla.'),
          h('p.ayuda', 'Lo que te propone aparece acá y en su charla. Nada se crea hasta que lo apruebes.'),
          h('button.btn', { onclick: function () { App.Agente.abrir(sec.id); } }, App.icono('charla'), 'Abrir la charla con ' + sec.nombre)),
        h('div.creador-redactar', h('div.redactar', txt, enviar), h('div.pie-charla', h('div.ayuda', 'Cmd/Ctrl+Enter para mandárselo · se abre su charla'))));
    } else {
      colChat = h('div.creador-col.creador-chat',
        h('div.creador-aviso-sec', App.icono('personas'), h('div', h('b', 'Ahora esto lo hace la secretaría'),
          h('span', 'Contratá una y pedile a ella lo que necesites: contratar, armar flujos, programar tareas. Mientras tanto, seguís pudiendo armarla acá.')),
          h('button.btn.chico', { onclick: function () { App.Ajustes.abrir('secretaria'); } }, 'Contratar secretaría')),
        cuerpoChat,
        h('div.creador-redactar', h('div.redactar', txt, enviar), h('div.pie-charla', selector, h('div.ayuda', 'Cmd/Ctrl+Enter para enviar · Podés pegar un texto largo'))));
    }

    /* ---- derecha: borrador ---- */
    var cabBorrador = h('div.creador-cab'), listaTarjetas = h('div.creador-tarjetas'), errBox = h('div.creador-errores');
    var botonAplicar = h('button.btn.primario', { onclick: aplicar }, 'Crear');
    var notaPie = h('span.ayuda');
    var colBorrador = h('div.creador-col.creador-borrador', cabBorrador, listaTarjetas, errBox, h('div.creador-pie', notaPie, h('span', { style: { flex: 1 } }), botonAplicar));

    App.add(hj.cuerpo, h('div.creador', colChat, colBorrador));

    /* ---------------- chat ---------------- */
    function pintarChat() {
      App.vaciar(lista);
      if (!mensajes.length) lista.appendChild(App.htmlSeguro(h('div.msg.a'), App.markdown(INTRO)));
      mensajes.forEach(function (m) {
        var b = m.rol === 'u' ? h('div.msg.u', m.texto) : App.htmlSeguro(h('div.msg.a' + (m.error ? '.e' : '')), App.markdown(m.texto));
        b.dataset.texto = m.texto || '';
        lista.appendChild(b);
      });
      if (corriendo || enviando) lista.appendChild(h('div.escribiendo', h('span.puntos', h('i'), h('i'), h('i')), 'El Creador está armando…'));
      cuerpoChat.scrollTop = cuerpoChat.scrollHeight;
      enviar.disabled = corriendo || enviando;
    }
    /* trae el estado del chat; mientras corra, vuelve a pedirlo cada 1,5 s y refresca el borrador */
    function sondear() {
      clearTimeout(relojChat);
      if (!viva()) return;
      api.get('/api/creador/estado', { session: sid }).then(function (r) {
        if (!viva()) return;
        var del = r.mensajes || [];
        if (del.length >= mensajes.length || !enviando) mensajes = del;
        corriendo = !!r.corriendo;
        if (corriendo) enviando = false;   // ya lo tomó el servidor
        pintarChat();
        cargarBorrador();
        if (corriendo || enviando) relojChat = setTimeout(sondear, 1500);
      }).catch(function (e) {
        if (!viva()) return;
        if (corriendo || enviando) relojChat = setTimeout(sondear, 3000);
        else App.fallo(e);
      });
    }
    function mandar() {
      if (sec) { mandarASecretaria(); return; }
      var t = txt.value.trim();
      if (!t || corriendo || enviando) return;
      enviando = true;
      mensajes.push({ rol: 'u', texto: t });
      txt.value = ''; txt.style.height = '';
      pintarChat();
      api.post('/api/creador/chat', Object.assign({ message: t, session: sid }, selector.valor())).then(function () {
        if (cerrada) return;
        corriendo = true; enviando = false;
        pintarChat();
        relojChat = setTimeout(sondear, 1500);
      }).catch(function (e) {
        enviando = false;
        txt.value = t;
        mensajes.pop();
        if (!cerrada) { pintarChat(); App.fallo(e); }
      });
    }

    /* con secretaría: el pedido va a su charla, que se abre (esta pantalla queda en Equipo › Propuestas) */
    function mandarASecretaria() {
      var t = txt.value.trim();
      if (!t) return;
      txt.value = ''; txt.style.height = '';
      App.Agente.enviarEn(sec.id, App.Agente.sesion(sec.id) || App.uuid(), t);
    }

    /* ---------------- borrador ---------------- */
    function cargarBorrador() {
      return api.get('/api/creador/borrador').then(function (r) {
        if (!viva()) return;
        versionVista = r.version;
        tarjetas = r.tarjetas || []; resumen = r.resumen || {};
        tarjetasActuales = tarjetas;
        pintarBorrador();
      }).catch(function (e) { if (viva()) { App.vaciar(listaTarjetas).appendChild(h('div.vacio', e.message)); } });
    }
    function alActividad(r) {
      if (cerrada || !r) return;
      if (r.creadorVersion !== undefined && r.creadorVersion !== versionVista) cargarBorrador();
    }
    alActividadActual = alActividad;

    function incluida(t) { return t.estado === 'lista' && !excluidas[t.id]; }
    function pintarCab() {
      App.vaciar(cabBorrador);
      var partes = [];
      if (resumen.lista) partes.push(plural(resumen.lista, 'lista', 'listas'));
      if (resumen.borrador) partes.push(plural(resumen.borrador, 'en borrador', 'en borrador'));
      if (resumen.creada) partes.push(plural(resumen.creada, 'creada', 'creadas'));
      if (resumen.error) partes.push(plural(resumen.error, 'con error', 'con error'));
      cabBorrador.appendChild(h('div.creador-resumen', h('b', 'Borrador'), h('span.ayuda', partes.length ? partes.join(' · ') : 'Sin tarjetas todavía')));
      var presentes = TIPOS.filter(function (tp) { return tarjetas.some(function (t) { return t.tipo === tp; }); });
      if (presentes.length) {
        var chips = h('div.creador-chips', h('button.chip' + (filtro ? '' : '.activo'), { onclick: function () { filtro = ''; pintarBorrador(); } }, 'Todas ' + tarjetas.length));
        presentes.forEach(function (tp) {
          var n = tarjetas.filter(function (t) { return t.tipo === tp; }).length;
          chips.appendChild(h('button.chip' + (filtro === tp ? '.activo' : ''), { onclick: function () { filtro = filtro === tp ? '' : tp; pintarBorrador(); } }, App.icono(TIPO_ICONO[tp]), TIPO_TXT[tp] + ' ' + n));
        });
        cabBorrador.appendChild(chips);
      } else filtro = '';
    }
    function pintarBorrador() {
      var y = listaTarjetas.scrollTop;
      pintarCab();
      Object.keys(editando).forEach(function (id) { if (!tarjetas.some(function (x) { return x.id === id; })) delete editando[id]; });
      App.vaciar(listaTarjetas);
      if (!tarjetas.length) {
        listaTarjetas.appendChild(h('div.vacio', sec ? 'Todavía no hay propuestas. Pedile a ' + sec.nombre + ' lo que necesites y aparecen acá.' : 'Todavía no hay tarjetas. Contame y las voy armando.'));
      } else {
        TIPOS.forEach(function (tp) {
          if (filtro && filtro !== tp) return;
          var grupo = tarjetas.filter(function (t) { return t.tipo === tp; });
          if (!grupo.length) return;
          listaTarjetas.appendChild(h('div.creador-grupo', App.icono(TIPO_ICONO[tp]), TIPO_TXT[tp], h('span.ayuda', String(grupo.length))));
          grupo.forEach(function (t) { listaTarjetas.appendChild(tarjetaEl(t)); });
        });
      }
      listaTarjetas.scrollTop = y;
      pintarPie();
    }
    function pintarPie() {
      var n = tarjetas.filter(incluida).length, quitar = tarjetas.filter(function (t) { return incluida(t) && t.accion === 'quitar'; }).length;
      botonAplicar.textContent = !n ? 'Crear' : n === 1 ? 'Crear 1 cosa' : 'Crear ' + n + ' cosas';
      botonAplicar.disabled = !n || aplicando;
      var nota = [];
      if (resumen.borrador) nota.push(plural(resumen.borrador, 'tarjeta espera', 'tarjetas esperan') + ' respuestas');
      if (quitar) nota.push(plural(quitar, 'quita', 'quitan') + ' algo de la oficina');
      notaPie.textContent = nota.join(' · ') || (n ? 'Revisalas antes de crear.' : '');
      App.vaciar(errBox);
      erroresAplicar.forEach(function (e) { errBox.appendChild(h('div.error-txt', e)); });
    }

    /* carga la pregunta de una tarjeta en el campo del chat para contestarla ahí */
    function responderEnChat(t, f) {
      var q = f.pregunta || f.campo || String(f);
      txt.value = (txt.value ? txt.value.replace(/\s+$/, '') + '\n' : '') + 'Sobre «' + tituloTarjeta(t) + '»: ' + q + ' ';
      txt.dispatchEvent(new Event('input'));
      txt.focus(); txt.setSelectionRange(txt.value.length, txt.value.length);
    }

    function tarjetaEl(t) {
      var d = t.datos || {};
      var dif = t.accion === 'modificar' ? diferencias(t) : [];
      var form = editando[t.id];
      /* una sola insignia: el estado si pide atención o ya terminó; si está lista, lo que va a hacer */
      var insignia = t.estado === 'lista'
        ? h('span.insignia' + (t.accion === 'quitar' ? '.error' : t.accion === 'modificar' ? '.aviso' : ''), ACCION_TXT[t.accion] || t.accion)
        : h('span.insignia' + (t.estado === 'creada' ? '.ok' : t.estado === 'error' ? '.error' : '.aviso'), ESTADO_TXT[t.estado] || t.estado);
      var cab = h('div.tb-cab',
        t.estado === 'lista' && !form ? h('input', { type: 'checkbox', checked: incluida(t), title: 'Incluirla al crear', 'aria-label': 'Incluir ' + tituloTarjeta(t), onchange: function () {
          if (this.checked) delete excluidas[t.id]; else excluidas[t.id] = true;
          pintarPie();
        } }) : null,
        h('span.tb-icono', App.icono(TIPO_ICONO[t.tipo])),
        h('div.tb-tit', h('b', tituloTarjeta(t)), h('span.ayuda', TIPO_UNO[t.tipo]),
          /* las que propuso la secretaría en una charla dicen de dónde vienen (docs/plan-secretaria-creadora.md) */
          t.deCharla ? h('button.tb-de-charla', { type: 'button', title: 'Ver la charla', onclick: function () { App.Agente.abrirSesion(t.deCharla, t.charla); } },
            'De la charla con ' + App.humano.quien(t.deCharla)) : null),
        insignia);
      var faltan = t.faltantes || [];
      var acciones = t.estado !== 'creada' && !form ? h('div.tb-acciones',
        h('button.btn.chico.fantasma.icono', { title: 'Descartar esta tarjeta', 'aria-label': 'Descartar', onclick: function () { descartar(t); } }, App.icono('papelera')),
        h('button.btn.chico', { onclick: function () { editando[t.id] = formulario(t); pintarBorrador(); } }, 'Editar')) : null;
      return h('div.tarjeta-borrador', { 'data-estado': t.estado, 'data-tipo': t.tipo, 'data-accion': t.accion },
        cab,
        form ? form.el : h('div.tb-cuerpo',
          t.tipo === 'regla' ? h('div.tb-texto', d.texto || '') : null,
          camposClave(t),
          dif.length ? h('div.tb-dif', h('b', 'Qué cambia'), dif.map(function (x) {
            return h('div.tb-dif-fila', h('span.tb-dif-etq', x.etq), h('span.tb-antes', x.antes), h('span.tb-flecha', '→'), h('span.tb-ahora', x.ahora));
          })) : null,
          faltan.length ? h('div.tb-faltan', h('b', 'Le falta'), faltan.map(function (f) {
            return h('div.tb-falta', h('span', f.pregunta || f.campo || String(f)),
              h('button.btn.chico.fantasma', { type: 'button', onclick: function () { responderEnChat(t, f); } }, sec ? 'Contestárselo a ' + sec.nombre : 'Responder en el chat'));
          })) : null,
          t.estado === 'error' && t.error ? h('div.error-txt', t.error) : null,
          t.origen ? h('blockquote.tb-origen', t.origen) : null),
        acciones);
    }

    function descartar(t) {
      api.del('/api/creador/tarjetas/' + encodeURIComponent(t.id)).then(cargarBorrador).catch(App.fallo);
    }

    /* ---------------- aplicar ---------------- */
    function aplicar() {
      var sel = tarjetas.filter(incluida);
      if (!sel.length || aplicando) return;
      var quitar = sel.filter(function (t) { return t.accion === 'quitar'; });
      var confirmado = quitar.length ? App.confirmar(quitar.length === 1 ? '¿Quitar algo de la oficina?' : '¿Quitar ' + quitar.length + ' cosas de la oficina?',
        'Se va a quitar: ' + quitar.map(tituloTarjeta).join(', ') + '. Lo demás se crea o cambia como figura en las tarjetas.', 'Quitar y crear', true) : Promise.resolve(true);
      confirmado.then(function (si) {
        if (!si || cerrada) return;
        aplicando = true; erroresAplicar = []; botonAplicar.disabled = true; botonAplicar.textContent = 'Creando…';
        var cuerpo = { ids: sel.map(function (t) { return t.id; }) };
        if (quitar.length) cuerpo.confirmarQuitar = true;
        return api.post('/api/creador/aplicar', cuerpo).then(function (r) {
          var res = r.resultados || [], ok = res.filter(function (x) { return x.ok; }).length;
          res.filter(function (x) { return !x.ok; }).forEach(function (x) {
            var t = tarjetaPorId(x.id);
            erroresAplicar.push((t ? tituloTarjeta(t) : 'Una tarjeta') + ': ' + (x.error || 'no se pudo crear'));
          });
          App.recargarOficina().catch(function () {});
          if (ok) App.aviso(ok === 1 ? 'Se creó 1 cosa.' : 'Se crearon ' + ok + ' cosas.');
          if (erroresAplicar.length) App.aviso(plural(erroresAplicar.length, 'no se pudo crear', 'no se pudieron crear'), true);
        }).catch(function (e) {
          if (e.status === 409 && e.datos && e.datos.borradores) {
            erroresAplicar = e.datos.borradores.map(function (b) {
              var t = tarjetaPorId(b.id);
              return (t ? tituloTarjeta(t) : 'Una tarjeta') + ' todavía le falta: ' + (b.faltantes || []).map(function (f) { return f.pregunta || f.campo; }).join(' / ');
            });
          }
          App.fallo(e);
        }).then(function () { aplicando = false; return cargarBorrador(); });
      });
    }

    /* ---------------- editar en la tarjeta ---------------- */
    function formulario(t) {
      var d = JSON.parse(JSON.stringify(t.datos || {}));
      var campos = [];   // {clave, leer()}
      var obj = {};
      var cont = h('div.tb-form');

      function fc(etq, el, ayuda) { return h('div.fila-campo', h('label.etiqueta-campo', etq), ayuda ? h('div.ayuda', ayuda) : null, el); }
      function reg(clave, el, leer) { campos.push({ clave: clave, leer: leer }); return el; }
      function vacioNull(v) { v = typeof v === 'string' ? v.trim() : v; return v === '' || (Array.isArray(v) && !v.length) ? null : v; }
      function texto(clave, etq, op) {
        op = op || {};
        var el = op.area ? h('textarea.campo', { rows: op.filas || 3, value: d[clave] || '', placeholder: op.ph || '' }) : h('input.campo', { value: d[clave] || '', placeholder: op.ph || '', type: op.tipo || 'text' });
        return fc(etq + (op.obl ? ' *' : ''), reg(clave, el, function () { return vacioNull(el.value); }), op.ayuda);
      }
      /* lista de textos cortos como chips; `leerFn(items)` arma lo que se guarda */
      function chips(clave, etq, valor, ayuda, op, leerFn) {
        op = op || {};
        var items = (valor || []).map(suelto).filter(Boolean);
        var el = App.chipsEditables(items, { placeholder: op.ph || 'Escribí y Enter', mostrar: op.mostrar });
        if (clave) reg(clave, el, function () { return leerFn ? leerFn(items) : vacioNull(items.slice()); });
        return { campo: fc(etq, el, ayuda), items: items };
      }
      function opcionesRef(tipo, extra) {
        var ops = [];
        if (extra) ops.push(extra);
        var base = tipo === 'departamento' ? (App.E.oficina.departamentos || []) : (App.E.oficina.agentes || []);
        base.forEach(function (x) { ops.push({ valor: x.id, titulo: x.nombre, retrato: tipo === 'agente' ? x : null, color: tipo === 'departamento' ? x.color : null }); });
        tarjetas.forEach(function (x) { if (x.tipo === tipo && x.accion !== 'quitar' && x.id !== t.id) ops.push({ valor: 'tarjeta:' + x.id, titulo: tituloTarjeta(x) + ' (propuesta)' }); });
        return ops;
      }
      /* elegir entre opciones a la vista; devuelve el control para poder leer .valor() */
      function eleccion(ops, valor, tipo) {
        if (valor && !buscar(ops, function (o) { return o.valor === valor; })) ops = ops.concat([{ valor: valor, titulo: nombreDe(tipo || 'agente', valor) }]);
        return App.elegir({ opciones: ops, valor: valor || '', forma: 'chips' });
      }
      function sel(clave, etq, ops, valor, op) {
        op = op || {};
        var el = eleccion(ops, valor, op.tipo);
        return fc(etq + (op.obl ? ' *' : ''), reg(clave, el, function () { return vacioNull(el.valor()); }), op.ayuda);
      }

      if (t.tipo === 'departamento') {
        var color = d.color || '';
        var muestra = h('button.muestra', { type: 'button', title: 'Cambiar el color', style: { background: color || 'var(--panel-2)' }, onclick: function () {
          App.elegirColor(muestra, color, function (c) { color = c; muestra.style.background = c; });
        } });
        App.add(cont, texto('nombre', 'Nombre', { obl: true }), texto('mision', 'Misión', { area: true, filas: 3 }),
          fc('Color', reg('color', h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, muestra, h('span.ayuda', 'Tocá para elegir')), function () { return color || null; })));
      } else if (t.tipo === 'agente') {
        var lim = d.limites || {};
        var solo = chips(null, 'Hace solo', lim.solo, 'Lo que puede hacer y entregar sin consultarte.');
        var prop = chips(null, 'Deja como propuesta', lim.proponer, 'Lo que deja para tu «Listo» antes de seguir.');
        reg('limites', solo.campo, function () { var a = solo.items.slice(), b = prop.items.slice(); if (!a.length && !b.length) return null; var o = {}; if (a.length) o.solo = a; if (b.length) o.proponer = b; return o; });
        var atajos = chips('chips', 'Atajos del chat', d.chips, 'Pedidos que aparecen a un toque en su charla.');
        var coord = h('input', { type: 'checkbox', checked: (d.permisos || []).indexOf('coordinador') >= 0 });
        /* conserva los demás permisos de la tarjeta: el check solo pone o saca «coordinador» */
        reg('permisos', coord, function () {
          var otros = (d.permisos || []).filter(function (p) { return p !== 'coordinador'; });
          if (coord.checked) otros.push('coordinador');
          return otros.length ? otros : null;
        });
        App.add(cont,
          h('div.dos', texto('nombre', 'Nombre', { obl: true }), texto('rol', 'Rol', { obl: true })),
          sel('departamento', 'Departamento', opcionesRef('departamento'), d.departamento, { obl: true, tipo: 'departamento' }),
          texto('prompt', 'Instrucciones', { area: true, filas: 6, obl: true, ayuda: 'Cómo trabaja, qué sabe y qué entrega.' }),
          texto('description', 'Descripción corta', {}),
          sel('modelo', 'Modelo', MODELOS.map(function (m) { return { valor: m[0], titulo: m[1] }; }), d.modelo || ''),
          atajos.campo, solo.campo, prop.campo,
          h('label.tb-check', coord, 'Es coordinador/a de la oficina'));
        if ((d.conectores || []).length) cont.appendChild(h('div.ayuda', 'Conectores: ' + valorTxt('conectores', d.conectores) + '. Se cambian desde una tarjeta de conector.'));
      } else if (t.tipo === 'regla') {
        App.add(cont, texto('texto', 'Texto de la regla', { area: true, filas: 4, obl: true }));
      } else if (t.tipo === 'conector') {
        var herr = { mostrar: App.humano.herramienta, ph: 'Nombre de la herramienta' };
        App.add(cont,
          sel('agente', 'Agente', opcionesRef('agente'), d.agente, { obl: true }),
          texto('servidor', 'Conector', { obl: true, ph: 'Ej.: Google Calendar' }),
          chips('leer', 'Puede leer', d.leer, 'Las herramientas que solo consultan.', herr).campo,
          chips('actuar', 'Puede hacer (con aprobación)', d.actuar, 'Las que cambian algo afuera: piden tu visto bueno.', herr).campo);
      } else if (t.tipo === 'tarea') {
        var dias = {}; (d.dias || []).forEach(function (n) { dias[n] = true; });
        var chipsDias = h('div.creador-dias', DIAS.map(function (x) {
          var b = h('button.chip', { type: 'button', 'aria-pressed': dias[x[0]] ? 'true' : 'false', onclick: function () {
            dias[x[0]] = !dias[x[0]]; b.setAttribute('aria-pressed', dias[x[0]] ? 'true' : 'false'); b.classList.toggle('activo', !!dias[x[0]]);
          } }, x[1]);
          if (dias[x[0]]) b.classList.add('activo');
          return b;
        }));
        reg('dias', chipsDias, function () { var l = DIAS.map(function (x) { return x[0]; }).filter(function (n) { return dias[n]; }); return l.length ? l : null; });
        /* la zona IANA queda escondida: por defecto se usa la de siempre */
        var zona = d.zona || '';
        var zonaCaja = h('div.zona-caja');
        var pintarZona = function (abierta) {
          App.vaciar(zonaCaja);
          if (abierta) {
            var inp = h('input.campo', { value: zona, placeholder: ZONA_BASE, 'aria-label': 'Zona horaria' });
            inp.addEventListener('input', function () { zona = inp.value.trim(); });
            App.add(zonaCaja, inp, h('div.ayuda', 'Nombre de la zona, como «America/Montevideo». Vacío usa la de la oficina.'));
            setTimeout(function () { inp.focus(); }, 0);
          } else {
            App.add(zonaCaja, h('button.btn.chico.fantasma', { type: 'button', onclick: function () { pintarZona(true); } },
              zona ? 'Zona horaria: ' + (zona.split('/').pop() || zona).replace(/_/g, ' ') + ' · cambiar' : 'Otra zona horaria'));
          }
        };
        pintarZona(false);
        reg('zona', zonaCaja, function () { return vacioNull(zona); });
        App.add(cont,
          sel('agente', 'Agente', opcionesRef('agente'), d.agente, { obl: true }),
          texto('nombre', 'Nombre', { obl: true }),
          texto('consigna', 'Consigna', { area: true, filas: 4, obl: true }),
          d.fecha ? null : fc('Días', chipsDias),
          texto('hora', 'Hora', { tipo: 'time', obl: true }),
          zonaCaja);
      } else if (t.tipo === 'flujo') {
        var pasos = JSON.parse(JSON.stringify(d.pasos || []));
        var cajaPasos = h('div.creador-pasos');
        var quienOps = function () { return opcionesRef('agente', { valor: 'persona', titulo: 'Vos' }); };
        var pintarPasos = function () {
          App.vaciar(cajaPasos);
          pasos.forEach(function (p, i) {
            var n = h('input.campo', { value: p.nombre || '', placeholder: 'Nombre del paso' });
            var q = eleccion(quienOps(), p.quien || '', 'agente');
            var c = h('textarea.campo', { rows: 2, value: p.consigna || '', placeholder: 'Consigna (qué tiene que hacer)' });
            var rc = h('input.campo', { value: p.recibe || '', placeholder: 'Qué recibe' });
            var en = h('input.campo', { value: p.entrega || '', placeholder: 'Qué entrega' });
            var ap = App.elegir({ opciones: [{ valor: '', titulo: 'Sin definir' }, { valor: 'si', titulo: 'Pide aprobación' }, { valor: 'no', titulo: 'Sin aprobación' }],
              valor: p.aprobacion === true ? 'si' : p.aprobacion === false ? 'no' : '' });
            var pl = h('input.campo', { type: 'number', min: 0, value: p.plazoDias == null ? '' : p.plazoDias, placeholder: 'Plazo (días)' });
            p._leer = function () {
              var o = {};
              Object.keys(p).forEach(function (k) { if (k !== '_leer') o[k] = p[k]; });
              function poner(k, v) { if (v === '' || v === null) delete o[k]; else o[k] = v; }
              poner('nombre', n.value.trim()); poner('quien', q.valor()); poner('consigna', c.value.trim()); poner('recibe', rc.value.trim()); poner('entrega', en.value.trim());
              if (ap.valor()) o.aprobacion = ap.valor() === 'si'; else delete o.aprobacion;
              poner('plazoDias', pl.value === '' ? '' : Math.max(0, parseInt(pl.value, 10) || 0));
              return o;
            };
            cajaPasos.appendChild(h('div.creador-paso',
              h('div.creador-paso-cab', h('b', 'Paso ' + (i + 1)), h('span', { style: { flex: 1 } }),
                h('button.btn.chico.fantasma', { type: 'button', title: 'Subir', disabled: i === 0, onclick: function () { guardarPasos(); pasos.splice(i - 1, 0, pasos.splice(i, 1)[0]); pintarPasos(); } }, '↑'),
                h('button.btn.chico.fantasma', { type: 'button', title: 'Bajar', disabled: i === pasos.length - 1, onclick: function () { guardarPasos(); pasos.splice(i + 1, 0, pasos.splice(i, 1)[0]); pintarPasos(); } }, '↓'),
                h('button.btn.chico.fantasma.icono', { type: 'button', title: 'Quitar este paso', 'aria-label': 'Quitar este paso', onclick: function () { guardarPasos(); pasos.splice(i, 1); pintarPasos(); } }, App.icono('papelera'))),
              n, fc('Quién lo hace', q), c, h('div.dos', rc, en), fc('Aprobación', ap), pl));
          });
          if (!pasos.length) cajaPasos.appendChild(h('div.ayuda', 'Sin pasos todavía.'));
        };
        var guardarPasos = function () { pasos = pasos.map(function (p) { return p._leer ? p._leer() : p; }); };
        pintarPasos();
        reg('pasos', cajaPasos, function () { guardarPasos(); var l = pasos.map(function (p) { var o = {}; Object.keys(p).forEach(function (k) { if (k !== '_leer') o[k] = p[k]; }); return o; }); return l.length ? l : null; });
        App.add(cont, texto('nombre', 'Nombre', { obl: true }), texto('descripcion', 'Qué hace este flujo', { area: true, filas: 2 }),
          h('label.etiqueta-campo', 'Pasos *'), cajaPasos,
          h('button.btn.chico', { type: 'button', style: { marginTop: '8px' }, onclick: function () { guardarPasos(); pasos.push({}); pintarPasos(); } }, App.icono('mas'), 'Agregar un paso'));
      }
      if (t.origen) cont.appendChild(h('blockquote.tb-origen', { style: { marginTop: '14px' } }, t.origen));

      var guardar = h('button.btn.primario', { onclick: function () {
        var datos = {};
        campos.forEach(function (c) { datos[c.clave] = c.leer(); });
        guardar.disabled = true;
        api.patch('/api/creador/tarjetas/' + encodeURIComponent(t.id), { datos: datos }).then(function (r) {
          var nueva = r.tarjeta || {}, falta = (nueva.faltantes || []);
          delete editando[t.id];
          cargarBorrador();
          App.aviso(falta.length ? 'Guardado. Todavía le faltan cosas.' : 'Guardado: la tarjeta está lista.');
        }).catch(function (e) { guardar.disabled = false; App.fallo(e); });
      } }, 'Guardar');
      var cancelar = h('button.btn', { onclick: function () { delete editando[t.id]; pintarBorrador(); } }, 'Cancelar');
      obj.el = h('div.tb-cuerpo.tb-edicion', cont, App.acciones(null, [cancelar, guardar]));
      return obj;
    }

    if (!sec) pintarChat();
    pintarBorrador();
    if (!sec) sondear();
    cargarBorrador();
  }

  /* Lo que sabe dibujar de una tarjeta, para las propuestas que la secretaría hace en la charla (tarjetas.js,
     docs/plan-secretaria-creadora.md). `todas`: las demás tarjetas, para nombrar las referencias «tarjeta:x». */
  function resumenTarjeta(t, todas) {
    var antes = tarjetasActuales;
    if (todas) tarjetasActuales = todas;
    try {
      var d = t.datos || {};
      return {
        titulo: tituloTarjeta(t), tipo: TIPO_UNO[t.tipo] || t.tipo, icono: TIPO_ICONO[t.tipo] || 'chispa',
        accion: ACCION_TXT[t.accion] || t.accion, estado: ESTADO_TXT[t.estado] || t.estado,
        campos: (t.tipo === 'regla' ? [h('div.tb-texto', d.texto || '')] : camposClave(t)).filter(Boolean)
      };
    } finally { tarjetasActuales = antes; }
  }

  App.Creador = { abrir: abrir, resumenTarjeta: resumenTarjeta, abierta: function () { return !!(abierta && abierta.el.isConnected); } };
})();
