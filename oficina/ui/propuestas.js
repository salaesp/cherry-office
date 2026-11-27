/* Propuestas y reportes en la bandeja: cómo se ve lo que un agente propone hacer afuera (un evento, un mail, otra acción)
   y el reporte de la secretaría. Cada tipo de acción tiene su forma: el evento es un ticket con la fecha grande, el mail
   se ve como mail y el resto va como tabla «Clave: valor». De dónde salió la propuesta (`origen`) va citado y lo que el
   agente ya comprobó (`nota`), en una línea. El reporte de la secretaría se arma con el formato fijo que le pide la
   consigna (URGENTE, resumen y secciones «## …»); si no lo sigue, se muestra el markdown como siempre. */
window.App = window.App || {};
App.Propuestas = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };

  /* ---------------- datos de la acción ---------------- */
  var TEXTO_ACCION = { send_message: 'Mandar el mail', send_email: 'Mandar el mail', create_draft: 'Guardar el borrador',
    create_event: 'Crear el evento', update_event: 'Cambiar el evento', delete_event: 'Borrar el evento' };
  function corto(herr) { return String(herr || '').replace(/^mcp__.*__/, ''); }
  function textoAprobar(ac) { return TEXTO_ACCION[corto(ac.herramienta)] || 'Aprobar y ejecutar'; }

  /* los argumentos de la acción como filas «Para: …», «Asunto: …» en vez de JSON; lo que no se conoce se muestra con su clave en palabras */
  var CLAVES = { to: 'Para', cc: 'Con copia', bcc: 'Con copia oculta', subject: 'Asunto', body: 'Mensaje', message: 'Mensaje', text: 'Mensaje',
    summary: 'Título', title: 'Título', start: 'Empieza', end: 'Termina', startTime: 'Empieza', endTime: 'Termina', when: 'Cuándo', date: 'Cuándo',
    attendees: 'Invitados', location: 'Dónde', description: 'Detalle', calendarId: 'Calendario', threadId: 'Conversación', replyTo: 'Responder a',
    name: 'Nombre', channel: 'Canal', url: 'Enlace' };
  var ORDEN = ['to', 'cc', 'bcc', 'subject', 'summary', 'title', 'start', 'startTime', 'when', 'date', 'end', 'endTime', 'location', 'attendees', 'body', 'message', 'text', 'description'];
  function claveHumana(k) {
    if (CLAVES[k]) return CLAVES[k];
    var t = String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function valorHumano(v) {
    if (v === null || v === undefined || v === '') return '';
    if (Array.isArray(v)) return v.map(valorHumano).filter(Boolean).join(', ');
    if (typeof v === 'object') { var f = v.dateTime || v.date || v.email || v.nombre || v.name; return f ? valorHumano(f) : JSON.stringify(v); }
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\d(T|$)/.test(v) && !isNaN(Date.parse(v))) return App.fecha ? App.fecha(v) : v;
    return String(v);
  }
  function tabla(d, sin) {
    var ks = Object.keys(d || {}).filter(function (k) { return !sin || sin.indexOf(k) < 0; }).sort(function (a, b) {
      var i = ORDEN.indexOf(a), j = ORDEN.indexOf(b);
      return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);
    });
    var filas = ks.map(function (k) {
      /* al lado de un ticket o un mail, lo que no se puede decir en palabras (recordatorios, colores…) queda en el detalle técnico */
      if (sin && d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) && !(d[k].dateTime || d[k].date || d[k].email || d[k].nombre || d[k].name)) return null;
      var v = valorHumano(d[k]); if (!v) return null;
      return h('div.acc-dato', h('div.acc-clave', claveHumana(k)), h('div.acc-valor', v));
    }).filter(Boolean);
    return filas.length ? h('div.acc-datos', filas) : null;
  }

  function primero(d, ks) {
    for (var i = 0; i < ks.length; i++) { var v = d[ks[i]]; if (v !== undefined && v !== null && v !== '') return v; }
    return undefined;
  }
  /* una fecha de evento: '2026-12-04', '2026-12-04T10:00:00-03:00' o {dateTime|date}; {d, dia} con dia=true si es de todo el día */
  function fechaEvento(v) {
    if (v && typeof v === 'object') v = v.dateTime || v.date;
    if (typeof v !== 'string') return null;
    var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v);
    if (m) return { d: new Date(+m[1], +m[2] - 1, +m[3]), dia: true };
    var t = Date.parse(v);
    return isNaN(t) ? null : { d: new Date(t), dia: false };
  }
  function horaTxt(d) { return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function mismoDia(a, b) { return a.toDateString() === b.toDateString(); }

  function tipo(ac) {
    var n = corto(ac.herramienta).toLowerCase(), d = ac.detalle || {};
    if (/event/.test(n) || (primero(d, ['start', 'startTime']) !== undefined && /calendar|cal/.test(String(ac.herramienta).toLowerCase()))) return 'evento';
    if (/mail|message|draft/.test(n) && (d.to !== undefined || d.subject !== undefined)) return 'mail';
    return 'otro';
  }
  var ETIQUETA = { evento: ['calendario', 'Evento'], mail: ['mail', 'Mail'], otro: ['flecha', 'Acción'] };
  function etiqueta(t) { var e = ETIQUETA[t] || ETIQUETA.otro; return h('span.prop-tag.' + t, App.icono(e[0]), e[1]); }

  /* ---------------- formas por tipo ---------------- */
  var CLAVES_EVENTO = ['summary', 'title', 'start', 'startTime', 'when', 'date', 'end', 'endTime', 'location', 'attendees', 'description', 'calendarId', 'timeZone', 'colorId'];
  function ticket(d) {
    var ini = fechaEvento(primero(d, ['start', 'startTime', 'when', 'date']));
    if (!ini) return null;
    var fin = fechaEvento(primero(d, ['end', 'endTime']));
    var cuando;
    if (ini.dia) cuando = 'Todo el día';
    else if (fin && !fin.dia && mismoDia(ini.d, fin.d)) cuando = horaTxt(ini.d) + ' a ' + horaTxt(fin.d);
    else if (fin && !fin.dia) cuando = horaTxt(ini.d) + ' hasta el ' + fin.d.toLocaleDateString('es', { weekday: 'short', day: 'numeric' }) + ', ' + horaTxt(fin.d);
    else cuando = horaTxt(ini.d);
    var titulo = valorHumano(primero(d, ['summary', 'title'])) || 'Evento sin título';
    var lugar = valorHumano(d.location), invitados = valorHumano(d.attendees);
    var linea = function (ico, txt) { return txt ? h('div.prop-linea', App.icono(ico), h('span', txt)) : null; };
    var detalle = typeof d.description === 'string' && d.description.trim() ? h('div.prop-desc', d.description.trim()) : null;
    return h('div.prop-ticket',
      h('div.prop-dia', h('span.m', ini.d.toLocaleDateString('es', { month: 'short' }).replace('.', '')), h('span.n', String(ini.d.getDate())),
        h('span.d', ini.d.toLocaleDateString('es', { weekday: 'long' }))),
      h('div.prop-info', h('div.prop-titulo', titulo), linea('hora', cuando), linea('pin', lugar), linea('personas', invitados), detalle));
  }

  function textoMail(d) {
    var v = primero(d, ['body', 'message', 'text', 'content', 'plainTextBody', 'htmlBody', 'html']);
    if (typeof v !== 'string') return '';
    if (/<[a-z][\s\S]*>/i.test(v)) {   // HTML: solo el texto, sin interpretar nada
      try { return (new DOMParser().parseFromString(v, 'text/html').body.textContent || '').trim(); } catch (x) { return ''; }
    }
    return v.trim();
  }
  var CLAVES_MAIL = ['to', 'cc', 'bcc', 'subject', 'body', 'message', 'text', 'content', 'plainTextBody', 'htmlBody', 'html', 'threadId', 'replyTo'];
  function mail(d) {
    var fila = function (k, v, cls) { return v ? [h('div.prop-mail-k', k), h('div' + (cls || ''), v)] : []; };
    var cuerpo = textoMail(d);
    return h('div.prop-mail',
      h('div.prop-mail-cab', fila('Para', valorHumano(d.to)), fila('Copia', valorHumano(d.cc)), fila('Copia oculta', valorHumano(d.bcc)),
        fila('Asunto', valorHumano(d.subject) || '(sin asunto)', '.prop-asunto')),
      cuerpo ? h('div.prop-mail-cuerpo', cuerpo) : h('div.prop-mail-cuerpo.vacio', 'Sin texto.'));
  }

  function origen(o) {
    if (!o || !(o.de || o.cita)) return null;
    var por = String(o.por || '').toLowerCase();
    var ico = /mail|correo|gmail/.test(por) ? 'mail' : /calend/.test(por) ? 'calendario' : 'charla';
    var quien = [o.de, o.por ? 'por ' + o.por : '', o.cuando].filter(Boolean).join(', ').replace(', por ', ' por ');
    return h('div.prop-origen' + (/whats/.test(por) ? '.wa' : ico === 'mail' ? '.mail' : ''), App.icono(ico),
      h('div', quien ? h('span', quien + (o.cita ? ': ' : '')) : null, o.cita ? h('q', o.cita) : null));
  }

  /* el cuerpo de la propuesta: la forma de su tipo, de dónde salió, lo que se comprobó y el detalle técnico al pie */
  function tarjeta(ac) {
    var d = ac.detalle || {}, t = tipo(ac), forma = null, resto = null;
    if (t === 'evento') { forma = ticket(d); resto = forma ? tabla(d, CLAVES_EVENTO) : null; }
    if (t === 'mail') { forma = mail(d); resto = tabla(d, CLAVES_MAIL); }
    if (!forma) { forma = tabla(d); resto = null; }
    var tiene = Object.keys(d).length > 0;
    return h('div.prop',
      forma,
      resto,
      origen(ac.origen),
      ac.nota ? h('div.prop-nota', App.icono('ok'), h('span', ac.nota)) : null,
      h('details.prop-tecnico', h('summary', App.humano.herramienta(ac.herramienta) + ' · detalle técnico'),
        h('pre', tiene ? JSON.stringify(d, null, 2) : 'Sin argumentos.')));
  }

  /* ---------------- reporte de la secretaría ---------------- */
  var SECCIONES = { 'para hacer': 'hacer', 'para saber': 'saber', seguimiento: 'seguimiento', agenda: 'agenda', 'mañana': 'agenda' };
  function sinMarcas(s) { return String(s).replace(/^\s*[-*•]\s+/, '').trim(); }

  /* el texto con el formato de la consigna → {urgente, resumen, secciones:[{nombre, clave, items}]}; null si no lo sigue */
  function parsear(texto) {
    var lineas = String(texto || '').replace(/\r/g, '').split('\n');
    var r = { urgente: [], resumen: [], secciones: [] }, actual = null, hay = false;
    lineas.forEach(function (l) {
      var t = l.trim();
      var m = /^#{2,3}\s+(.+?)\s*:?$/.exec(t);
      if (m) {
        hay = true;
        var nombre = m[1].replace(/\*\*/g, '').trim();
        actual = { nombre: nombre, clave: SECCIONES[nombre.toLowerCase()] || '', items: [] };
        r.secciones.push(actual);
        return;
      }
      if (t === '') return;
      var u = /^\**URGENTE\**\s*:\s*\**\s*(.+?)\**$/i.exec(t);
      if (u && !actual) { r.urgente.push(u[1]); return; }
      if (!actual) { r.resumen.push(t); return; }
      if (/^\s*[-*•]\s+/.test(l)) actual.items.push(sinMarcas(l));
      else if (actual.items.length) actual.items[actual.items.length - 1] += ' ' + t;
      else actual.items.push(t);
    });
    if (!hay || !r.secciones.some(function (s) { return s.clave; })) return null;
    r.secciones = r.secciones.filter(function (s) { return s.items.length; });
    return r;
  }

  /* «**Juli** · WhatsApp · 16:20 — pregunta si…» → {quien, fuente, hora, que} */
  function itemSaber(s) {
    var m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(s);
    if (!m) return null;
    var resto = m[2], que = '', cab = resto;
    var corte = resto.search(/\s[—–-]\s/);
    if (corte >= 0) { cab = resto.slice(0, corte); que = resto.slice(corte + 3).trim(); }
    else if (/^\s*:/.test(resto)) { cab = ''; que = resto.replace(/^\s*:\s*/, ''); }
    var partes = cab.split('·').map(function (x) { return x.trim(); }).filter(Boolean);
    var hora = '', fuente = '';
    partes.forEach(function (p) { if (/^\d{1,2}[:.]\d{2}$/.test(p) || /^(hoy|ayer)\b/i.test(p)) hora = p; else if (!fuente) fuente = p; });
    return { quien: m[1].trim(), fuente: fuente, hora: hora, que: que };
  }
  /* «… — desde 21/11» o «… — 6 días» → [texto, cuánto] */
  function partirFinal(s) {
    var i = s.search(/\s[—–]\s[^—–]*$/);
    return i < 0 ? [s, ''] : [s.slice(0, i).trim(), s.slice(i + 3).trim()];
  }
  function claseFuente(f) {
    f = String(f || '').toLowerCase();
    return /whats/.test(f) ? 'wa' : /mail|correo|gmail/.test(f) ? 'mail' : /calend|agenda/.test(f) ? 'cal' : '';
  }
  function inicial(s) { var c = String(s || '?').replace(/[^\p{L}\p{N}]/gu, '').charAt(0); return (c || '?').toUpperCase(); }
  function md(s) { return App.htmlSeguro(h('span.prop-md'), App.markdown(s).replace(/^<p>|<\/p>\s*$/g, '')); }

  function seccion(titulo, cuerpo) { return h('div.rep-sec', h('h3', titulo), cuerpo); }

  /* el reporte armado; null si el texto no sigue el formato (se muestra el markdown de siempre) */
  function reporte(texto, acciones, op) {
    var r = parsear(texto);
    if (!r) return null;
    op = op || {};
    var caja = h('div.rep');
    r.urgente.forEach(function (u) { caja.appendChild(h('div.rep-urg', App.icono('alerta'), md(u))); });
    if (r.resumen.length) caja.appendChild(h('div.rep-resumen', md(r.resumen.join(' '))));

    var porClave = {};
    r.secciones.forEach(function (s) { if (s.clave) porClave[s.clave] = s; });
    var cuenta = { wa: 0, mail: 0 };
    (porClave.saber ? porClave.saber.items : []).forEach(function (it) { var x = itemSaber(it); var c = x && claseFuente(x.fuente); if (c === 'wa' || c === 'mail') cuenta[c]++; });
    var chips = [];
    if (cuenta.wa) chips.push(h('span.prop-tag.wa', App.icono('charla'), 'WhatsApp · ' + cuenta.wa));
    if (cuenta.mail) chips.push(h('span.prop-tag.mail', App.icono('mail'), 'Mails · ' + cuenta.mail));
    if (porClave.agenda) chips.push(h('span.prop-tag.evento', App.icono('calendario'), 'Agenda · ' + porClave.agenda.items.length));
    if (chips.length) caja.appendChild(h('div.rep-chips', chips));

    /* para hacer: lo que propuso (con su estado y un «Ver») y lo que contó sin poder proponer */
    var acs = (acciones || []).filter(function (a) { return a.estado !== 'descartada'; });
    var hacer = (porClave.hacer ? porClave.hacer.items : []);
    if (acs.length || hacer.length) {
      var filas = acs.map(function (a) {
        var t = tipo(a), d = a.detalle || {}, sub = '';
        if (t === 'evento') { var f = fechaEvento(primero(d, ['start', 'startTime'])); if (f) sub = f.d.toLocaleDateString('es', { weekday: 'short', day: 'numeric' }) + (f.dia ? '' : ', ' + horaTxt(f.d)) + (d.location ? ' · ' + valorHumano(d.location) : ''); }
        if (t === 'mail') sub = 'Para ' + valorHumano(d.to);
        var estado = a.estado === 'hecha' ? h('span.insignia.ok', 'Hecha') : a.estado === 'error' ? h('span.insignia.error', 'Con error')
          : a.estado === 'ejecutando' ? h('span.insignia.aviso', 'Ejecutando…') : null;
        return h('div.rep-prop.' + t, App.icono(ETIQUETA[t][0]),
          h('div.min', h('b', a.resumen), sub ? h('div.sub', sub) : null),
          estado || (a.entrega && op.ver ? h('button.btn.chico', { onclick: function () { op.ver(a.entrega); } }, 'Ver') : null));
      });
      hacer.forEach(function (it) { filas.push(h('div.rep-prop', App.icono('flecha'), h('div.min', md(it)))); });
      caja.appendChild(seccion('Para hacer', h('div.rep-lista', filas)));
    }

    r.secciones.forEach(function (s) {
      if (s.clave === 'hacer') return;
      if (s.clave === 'saber') {
        caja.appendChild(seccion(s.nombre, h('div.rep-lista', s.items.map(function (it) {
          var x = itemSaber(it);
          if (!x) return h('div.rep-item', h('span.rep-punto'), h('div.min', md(it)), h('span'));
          return h('div.rep-item', h('span.rep-ini.' + (claseFuente(x.fuente) || 'otro'), { title: x.fuente || '' }, inicial(x.quien)),
            h('div.min', h('div.q', x.quien), x.que ? h('div.que', md(x.que)) : null), h('span.cu', x.hora));
        }))));
      } else if (s.clave === 'seguimiento') {
        caja.appendChild(seccion(s.nombre, h('div.rep-lista', s.items.map(function (it) {
          var p = partirFinal(it);
          return h('div.rep-seg', h('div.min', md(p[0])), p[1] ? h('span.cu.aviso', p[1]) : null);
        }))));
      } else if (s.clave === 'agenda') {
        caja.appendChild(seccion(s.nombre, h('div.rep-agenda', s.items.map(function (it) {
          var p = /^(.+?)\s[—–-]\s(.+)$/.exec(it);
          return p ? [h('div.h', p[1].replace(/\*\*/g, '')), h('div.e', md(p[2]))] : [h('div.h'), h('div.e', md(it))];
        }))));
      } else {
        caja.appendChild(seccion(s.nombre, App.htmlSeguro(h('div.md-doc'), App.markdown(s.items.map(function (x) { return '- ' + x; }).join('\n')))));
      }
    });
    return caja;
  }

  /* «Reporte del jueves 27» */
  function tituloReporte(iso) {
    var d = new Date(iso); if (isNaN(d)) return 'Reporte de la secretaría';
    var hoy = new Date(), ayer = new Date(Date.now() - 86400000);
    if (mismoDia(d, hoy)) return 'Lo de hoy, ' + d.toLocaleDateString('es', { weekday: 'long', day: 'numeric' });
    if (mismoDia(d, ayer)) return 'Lo de ayer, ' + d.toLocaleDateString('es', { weekday: 'long', day: 'numeric' });
    return 'Reporte del ' + d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /* ---------------- importación a la memoria de la secretaría ---------------- */
  /* el texto que arma el backend (textoEntrega en secretaria-importar.ts) → {lead, nota, cifras, errores, salteados, revisar}; null si no es ese */
  function parsearImportacion(texto) {
    var lineas = String(texto || '').replace(/\r/g, '').split('\n');
    var r = { lead: '', carpeta: '', nota: '', cifras: {}, errores: [], salteados: [], revisar: [] }, modo = '';
    lineas.forEach(function (l) {
      var t = l.trim(); if (!t) return;
      var m;
      if (!r.lead) {
        m = /^(.*?las notas de «(.+?)» a mi memoria\.)\s*(.*)$/.exec(t);
        if (!m) return;
        r.lead = m[1]; r.carpeta = m[2]; r.nota = m[3]; return;
      }
      if ((m = /^- Archivos: (\d+)[^;]*; se importaron (\d+)/.exec(t))) { r.cifras.archivos = +m[1]; return; }
      if ((m = /^- Temas en seguimiento: (\d+) cread\w+ y (\d+) actualizad/.exec(t))) { r.cifras.temasNuevos = +m[1]; r.cifras.temasAct = +m[2]; return; }
      if ((m = /^- Fichas: (\d+) cread\w+ y (\d+) actualizad/.exec(t))) { r.cifras.fichasNuevas = +m[1]; r.cifras.fichasAct = +m[2]; return; }
      if ((m = /^- Días del diario con anotaciones: (\d+)/.exec(t))) { r.cifras.dias = +m[1]; return; }
      if (/^Tandas que no se pudieron hacer/.test(t)) { modo = 'errores'; return; }
      if (/^No se importaron/.test(t)) { modo = 'salteados'; return; }
      if (/^Entre ellos, los que podrías querer revisar/.test(t)) { modo = 'revisar'; return; }
      if (/^Lo importado está en/.test(t)) { modo = ''; return; }
      if (/^- /.test(t) && modo) r[modo].push(t.slice(2));
    });
    return r.lead && r.cifras.archivos !== undefined ? r : null;
  }

  function cifra(n, txt, sub) { return h('div.imp-cifra', h('b', (n || 0).toLocaleString('es-AR')), h('span', txt), sub ? h('small', sub) : null); }

  /* op.importacion: {detalle:{temasNuevos,…}} de la API; op.memoria: {temas, fichas}; op.ver(clase, slug, titulo); op.abrirMemoria() */
  function importacion(texto, op) {
    var r = parsearImportacion(texto);
    if (!r) return null;
    op = op || {};
    var c = r.cifras, caja = h('div.rep');
    caja.appendChild(h('div.rep-resumen', r.lead.replace(/ a mi memoria\.$/, ' a la memoria.')));
    if (r.nota) caja.appendChild(h('div.prop-nota', App.icono('ok'), h('span', r.nota)));
    caja.appendChild(h('div.imp-cifras',
      cifra(c.archivos, c.archivos === 1 ? 'archivo leído' : 'archivos leídos'),
      cifra(c.temasNuevos, c.temasNuevos === 1 ? 'tema nuevo' : 'temas nuevos', c.temasAct ? '+ ' + c.temasAct + ' actualizados' : ''),
      cifra(c.fichasNuevas, c.fichasNuevas === 1 ? 'ficha nueva' : 'fichas nuevas', c.fichasAct ? '+ ' + c.fichasAct + ' actualizadas' : ''),
      cifra(c.dias, c.dias === 1 ? 'día del diario' : 'días del diario')));
    if (r.errores.length) caja.appendChild(h('div.rep-urg', App.icono('alerta'), h('div', h('div', r.errores.length === 1 ? 'Una tanda no se pudo hacer: sus archivos quedan para «Volver a importar».' : r.errores.length + ' tandas no se pudieron hacer: sus archivos quedan para «Volver a importar».'),
      h('div', { style: { fontWeight: 400, marginTop: '4px' } }, r.errores.join(' · ')))));

    /* lo que conviene revisar: los temas y las fichas que dejó, cada uno se abre desde acá */
    var d = (op.importacion && op.importacion.detalle) || null;
    var temas = d ? d.temasNuevos.map(function (x) { return [x, true]; }).concat(d.temasActualizados.map(function (x) { return [x, false]; })) : [];
    var fichas = d ? d.fichasNuevas.concat(d.fichasActualizadas) : [];
    var abrir = op.abrirMemoria ? h('button.btn.chico', { onclick: op.abrirMemoria }, 'Abrir la memoria') : null;
    if (temas.length) {
      var porSlug = {};
      ((op.memoria && op.memoria.temas) || []).forEach(function (t) { porSlug[t.slug] = t; });
      var ESTADO = { abierto: 'Abierto', esperando: 'Esperando', resuelto: 'Resuelto', descartado: 'Descartado' };
      var filas = temas.map(function (x) {
        var t = porSlug[x[0]];
        if (!t) return null;   // lo borraste o lo renombraste después
        var sub = [ESTADO[t.estado] || t.estado, t.fecha ? 'para el ' + t.fecha.replace(/^(\d{4})-(\d\d)-(\d\d).*/, '$3/$2') : '', x[1] ? '' : 'ya estaba'].filter(Boolean).join(' · ');
        return h('div.rep-prop', App.icono('parte'), h('div.min', h('b', t.titulo), h('div.sub', sub)),
          op.ver ? h('button.btn.chico', { onclick: function () { op.ver('temas', t.slug, t.titulo); } }, 'Ver') : null);
      }).filter(Boolean);
      if (filas.length) caja.appendChild(h('div.rep-sec', h('h3', 'Temas para revisar'), h('div.rep-lista', filas)));
    }
    if (fichas.length) {
      var porFicha = {};
      ((op.memoria && op.memoria.fichas) || []).forEach(function (f) { porFicha[f.slug] = f; });
      var chips = fichas.map(function (slug) {
        var f = porFicha[slug]; if (!f) return null;
        return h('button.imp-ficha', { title: 'Ver la ficha', onclick: function () { if (op.ver) op.ver('fichas', f.slug, f.nombre); } }, h('span.rep-ini.otro', inicial(f.nombre)), f.nombre);
      }).filter(Boolean);
      if (chips.length) caja.appendChild(h('div.rep-sec', h('h3', 'Personas y cosas'), h('div.imp-fichas', chips)));
    }
    if (r.salteados.length) {
      caja.appendChild(h('div.rep-sec', h('h3', 'Lo que no se importó'),
        h('div.rep-chips', r.salteados.map(function (x) { var m = /^(.*): (\d+)$/.exec(x); return h('span.insignia', m ? m[1] + ' · ' + m[2] : x); })),
        r.revisar.length ? h('div.rep-lista', r.revisar.map(function (x) { return h('div.rep-seg', h('div.min', x)); })) : null));
    }
    caja.appendChild(h('div.imp-pie', h('span', 'Todo lo importado lleva el origen «Importado · …». Revisalo y corregí lo que haga falta.'), abrir));
    return caja;
  }

  return { tipo: tipo, etiqueta: etiqueta, tarjeta: tarjeta, tabla: tabla, textoAprobar: textoAprobar, reporte: reporte, parsear: parsear,
    itemSaber: itemSaber, tituloReporte: tituloReporte, importacion: importacion, parsearImportacion: parsearImportacion };
})();
