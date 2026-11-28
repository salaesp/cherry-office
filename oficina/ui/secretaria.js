/* Secretaría (docs/plan-secretaria.md): Ajustes › Secretaría. Se contrata en un paso (tiene su despacho al lado del tuyo, ya
   configurada con los chats elegidos de WhatsApp y, si están conectados, Gmail y el calendario) y se configura todo acá:
   qué chats revisa (de la lista completa: elegir uno acá lo elige también en Ajustes › WhatsApp), cada cuánto, Gmail y
   Calendario (prenderlos le asigna el conector), la franja horaria y «Revisar ahora». Cada fuente es un renglón con su
   resumen que se abre de a uno; los chats elegidos son chips; el historial de revisiones y reportes va en una hoja aparte
   («Historial») y en la pantalla queda solo como una tira de puntos. En la ficha del agente queda un
   resumen con «Configurar». Revisar y avisar van separados: cada fuente se revisa con su intervalo (sin dejar nada en la
   bandeja, salvo lo urgente) y el reporte junta todo a las horas que elegís. Su memoria privada (bloque «Memoria») está en
   secretaria-memoria.js. API: GET/PUT /api/secretaria, POST /api/secretaria/contratar, /revisar y /reportar. */
(function () {
  var h = App.h;
  var api = function () { return App.api; };

  var ESTADO_REV = { corriendo: 'Revisando…', ok: 'Lista', fallida: 'Falló', incierta: 'Se cortó' };

  /* ---------------- Ajustes › Secretaría ---------------- */
  function pintar(crear) {
    var vivo = true, reloj = null, datos = null, filtro = '';
    var hj = crear({ titulo: 'Secretaría', ancho: 720, alCerrar: function () { vivo = false; clearTimeout(reloj); } });
    var caja = h('div.sec', App.cargando('Mirando la secretaría…'));
    App.add(hj.cuerpo, caja);
    if (!hj.enVentana) App.add(hj.pie, h('button.btn.primario', { onclick: hj.cerrar }, 'Listo'));

    function cargar() {
      return api().get('/api/secretaria').then(function (r) { if (vivo) { datos = r; dibujar(); } })
        .catch(function (e) { if (vivo) App.vaciar(caja).appendChild(h('div.error-txt', e.message)); });
    }
    function guardar(cambios, texto) {
      return api().put('/api/secretaria', cambios).then(function (r) {
        datos = r; dibujar();
        if (texto) App.guardado(texto);
        if (App.recargarOficina) App.recargarOficina();
      }).catch(function (e) { App.fallo(e); dibujar(); });
    }
    function dibujar() {
      clearTimeout(reloj);
      App.vaciar(caja);
      if (!datos.config || !datos.agente) dibujarContratar();
      else dibujarConfig(datos.config);
      if (datos.corriendo || datos.reporteCorriendo) reloj = setTimeout(function () { if (vivo) cargar(); }, 3000);
    }
    function fuente(id) { return (datos.fuentes || []).filter(function (f) { return f.id === id; })[0]; }

    /* ---- sin secretaría: contratar en un paso ---- */
    function dibujarContratar() {
      var nombre = h('input.campo', { placeholder: 'Por ejemplo, Alex', style: { maxWidth: '260px' } });
      var gm = fuente('gmail'), cal = fuente('calendario');
      var wa = datos.whatsapp && datos.whatsapp !== 'apagado';
      var elegidos = (datos.chatsWhatsApp || []).filter(function (c) { return c.elegido; }).length;
      var item = function (ok, texto) { return h('li', { style: { color: ok ? '' : 'var(--suave)' } }, texto); };
      var err = h('div.error-txt');
      var btn = h('button.btn.primario', { onclick: function () {
        btn.disabled = true; err.textContent = '';
        api().post('/api/secretaria/contratar', { nombre: nombre.value }).then(function (r) {
          datos = r; dibujar();
          App.guardado((r.agente ? r.agente.nombre : 'La secretaría') + ' ya está en la secretaría, al lado de tu despacho.');
          if (App.recargarOficina) App.recargarOficina();
        }).catch(function (e) { err.textContent = e.message; btn.disabled = false; });
      } }, 'Contratar');
      App.add(caja,
        h('div.ayuda', { style: { marginTop: 0, marginBottom: '12px' } },
          'Alguien en la secretaría, al lado de tu despacho, que está al tanto de lo que te llega y te deja un reporte en la bandeja, con sugerencias que vos aprobás: por ejemplo, si tu mamá te avisa que tiene turno con el médico, te propone agendarlo.'),
        App.seccion('Va a revisar', h('ul', { style: { margin: '0 0 4px', paddingLeft: '18px', lineHeight: '1.7' } },
          item(wa, wa ? 'WhatsApp: ' + (elegidos ? elegidos + (elegidos === 1 ? ' chat elegido' : ' chats elegidos') + ' (después elegís cuáles)' : 'los chats que elijas') : 'WhatsApp, cuando lo vincules en Ajustes › WhatsApp'),
          item(gm && gm.disponible, gm && gm.disponible ? 'Gmail: los mails importantes' : 'Gmail, si lo conectás en claude.ai'),
          item(cal && cal.disponible, cal && cal.disponible ? 'Calendario: tu agenda, y puede proponerte eventos' : 'Calendario, si lo conectás en claude.ai'))),
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap' } }, h('span', 'Nombre'), nombre, btn),
        err,
        h('div.ajuste-ayuda', { style: { marginTop: '8px' } }, 'Tiene su escritorio al lado de tu despacho. Solo lee: nunca manda mensajes ni hace nada sin que lo apruebes.'),
        App.SecretariaMemoria ? App.SecretariaMemoria.bloque(false) : null);
    }

    /* ---- con secretaría ----
       Arriba quién atiende, si revisa sola y «Revisar ahora» (lo poco usado en «⋯»); una línea con el próximo reporte y las
       últimas revisiones como puntos («Historial» abre el detalle); las fuentes como renglones que se abren de a uno; el
       reporte y el horario en renglones; la memoria al final. */
    var abierta = 'whatsapp', chipsTodos = false, chatsGuardados = null;
    var CADAS = [[15, 'minutos', '15 min'], [30, 'minutos', '30 min'], [1, 'horas', '1 h'], [4, 'horas', '4 h'], [12, 'horas', '12 h']];
    var NOMBRES_FUENTE = { whatsapp: 'WhatsApp', gmail: 'Gmail', calendario: 'Calendario' };
    function textoCada(c) { return c.unidad === 'minutos' ? c.valor + ' min' : c.valor + ' h'; }
    /* cada cuánto: botones con los valores de siempre (y el guardado, si es otro) */
    function selectorCada(cada, alCambiar) {
      var ops = CADAS.map(function (x) { return { valor: x[0] + ' ' + x[1], titulo: x[2] }; });
      var actual = cada.valor + ' ' + cada.unidad;
      if (!ops.some(function (o) { return o.valor === actual; })) ops.push({ valor: actual, titulo: textoCada(cada) });
      return App.elegir({ forma: 'segmento', etiqueta: 'Cada cuánto revisa', valor: actual, opciones: ops,
        alCambiar: function (v) { var p = v.split(' '); alCambiar({ valor: Number(p[0]), unidad: p[1] }); } });
    }
    function marcaFuente(id) {
      return h('div.renglon-marca.' + ({ whatsapp: 'wa', gmail: 'mail', calendario: 'cal' }[id] || ''), App.icono({ whatsapp: 'charla', gmail: 'mail', calendario: 'calendario' }[id] || 'enchufe'));
    }
    function alternar(id) { abierta = abierta === id ? null : id; dibujar(); }

    function dibujarConfig(cfg) {
      var ag = datos.agente;
      var err = h('div.error-txt');

      /* quién, si revisa sola, charlar, revisar ahora y «⋯» */
      var ocupada = !!(datos.corriendo || datos.reporteCorriendo);
      var ahora = h('button.btn.primario', { disabled: ocupada, onclick: function () {
        ahora.disabled = true; err.textContent = '';
        api().post('/api/secretaria/revisar', {}).then(function (r) { App.guardado(r.motivo || ag.nombre + ' está revisando.'); return cargar(); })
          .catch(function (e) { err.textContent = e.message; ahora.disabled = false; });
      } }, datos.corriendo ? 'Revisando…' : datos.reporteCorriendo ? 'Armando el reporte…' : 'Revisar ahora');
      var armar = function () {
        err.textContent = '';
        api().post('/api/secretaria/reportar', {}).then(function (r) { App.guardado(r.motivo || ag.nombre + ' está armando el reporte.'); return cargar(); })
          .catch(function (e) { err.textContent = e.message; });
      };
      var cerrarSec = function () {
        App.confirmar('¿Cerrar la secretaría?', ag.nombre + ' deja de revisar (sigue en la oficina; si querés, despedilo desde su ficha). Los reportes que ya dejó quedan en la bandeja, y su memoria también (podés borrarla desde «Memoria»).', 'Cerrar', true).then(function (si) {
          if (si) guardar({ agente: null }, 'La oficina ya no tiene secretaría.');
        });
      };
      var mas = h('button.btn.icono', { title: 'Más opciones', onclick: function (ev) {
        App.menu(ev.currentTarget, [
          ocupada ? null : { texto: 'Armar el reporte ahora', icono: 'bandeja', nota: 'con lo que ya revisó', accion: armar },
          { texto: 'Historial', icono: 'reloj', accion: verHistorial },
          '-',
          { texto: 'Cerrar la secretaría', icono: 'cerrar', peligro: true, accion: cerrarSec }].filter(Boolean));
      } }, App.icono('puntos'));
      var agFicha = App.agente ? App.agente(ag.id) : null;
      caja.appendChild(h('div.sec-cabeza',
        agFicha ? App.retratoImg(agFicha, 'retrato', 64) : h('div.renglon-marca', App.icono('personas')),
        h('div.renglon-txt', h('div.sec-nombre', ag.nombre), h('div.renglon-sub', cfg.activa ? 'Revisa sola' : 'En pausa: revisa cuando se lo pedís')),
        App.interruptor(cfg.activa, function (si) { guardar({ activa: si }, si ? 'La secretaría vuelve a revisar.' : 'La secretaría queda en pausa.'); }, 'Revisa sola'),
        h('button.btn', { onclick: function () { if (App.Agente) App.Agente.abrir(ag.id, 'chat'); } }, App.icono('charla'), 'Charlar'),
        ahora, mas));
      caja.appendChild(err);

      /* una secretaría armada antes de que existiera su despacho: ofrecer pasarla, y sacarle el permiso que ya no usa */
      if (ag.departamento !== 'recepcion' || (ag.permisos || []).indexOf('whatsapp') >= 0) {
        var acomodar = h('button.btn.chico', { onclick: function () {
          acomodar.disabled = true;
          var cambios = { departamento: 'recepcion' };
          if ((ag.permisos || []).indexOf('whatsapp') >= 0) cambios.permisos = ag.permisos.filter(function (x) { return x !== 'whatsapp'; });
          api().patch('/api/agentes/' + encodeURIComponent(ag.id), cambios).then(function (r) {
            if (r.oficina && App.actualizar) App.actualizar(r.oficina);
            App.guardado(ag.nombre + ' ya está en la secretaría, al lado de tu despacho.');
            return cargar();
          }).catch(function (e) { App.fallo(e); acomodar.disabled = false; });
        } }, 'Pasar a la secretaría');
        var por = [];
        if (ag.departamento !== 'recepcion') por.push('se sienta en la secretaría, al lado de tu despacho');
        if ((ag.permisos || []).indexOf('whatsapp') >= 0) por.push('le saca «Puede leer WhatsApp», que ya no hace falta');
        caja.appendChild(App.renglon({ titulo: 'Acomodar a ' + ag.nombre, sub: 'Con esto ' + por.join(' y ') + '.', control: acomodar }));
      }

      caja.appendChild(lineaEstado());

      /* qué revisa */
      var fuentesEl = [bloqueWhatsApp(cfg)];
      (datos.fuentes || []).filter(function (f) { return f.tipo === 'conector'; }).forEach(function (f) { fuentesEl.push(bloqueConector(cfg, f)); });
      caja.appendChild(App.seccion('Qué revisa', fuentesEl));

      /* reporte y horario */
      caja.appendChild(App.seccion('Reporte', [renglonHoras(cfg), renglonFranja(cfg),
        App.renglon({ titulo: 'Dejarlo aunque no haya novedades', control: App.interruptor(cfg.reporteVacio, function (si) {
          guardar({ reporteVacio: si }, si ? 'Te deja el reporte aunque no haya novedades.' : 'Sin novedades, no te deja reporte.');
        }, 'Dejar el reporte aunque no haya novedades') })]));

      /* memoria privada de la secretaría (secretaria-memoria.js) */
      if (App.SecretariaMemoria) caja.appendChild(App.SecretariaMemoria.bloque(true, true));
    }

    /* Próximo reporte, cuántas revisiones esperan y las últimas revisiones como puntos (el detalle, en «Historial») */
    function lineaEstado() {
      var prox = datos.proximoReporte ? new Date(datos.proximoReporte * 1000) : null;
      var proxTxt = prox ? (prox.toDateString() === new Date().toDateString() ? 'hoy' : 'mañana') + ' ' + prox.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
      var espera = datos.sinReportar ? ' · ' + datos.sinReportar + (datos.sinReportar === 1 ? ' revisión esperando' : ' revisiones esperando') : '';
      var revs = (datos.revisiones || []).slice(0, 12).reverse();
      var puntos = revs.map(function (r) {
        var clase = r.estado === 'corriendo' ? 'corre' : r.estado !== 'ok' ? 'falla' : r.urgente ? 'urgente' : r.vacia ? '' : 'algo';
        var que = r.estado !== 'ok' ? (ESTADO_REV[r.estado] || r.estado) : r.vacia ? 'sin novedades' : r.urgente ? 'avisó algo urgente' : r.reporte ? 'ya en un reporte' : 'para el próximo reporte';
        return h('i' + (clase ? '.' + clase : ''), { title: App.hace(r.creada) + ' · ' + (r.fuentes || []).map(function (f) { return NOMBRES_FUENTE[f] || f; }).join(', ') + ' · ' + que });
      });
      return h('div.sec-estado',
        h('span', proxTxt ? ['Próximo reporte ', h('b', proxTxt)] : 'Sin reporte programado', espera),
        h('span.sec-estado-esp'),
        puntos.length ? h('span.sec-puntos', { title: 'Últimas revisiones' }, puntos) : null,
        h('button.btn.chico.fantasma', { onclick: verHistorial }, 'Historial'));
    }

    /* Hoja con los últimos reportes y revisiones (lo que antes ocupaba la pantalla) */
    function verHistorial() {
      var hj2 = App.hoja({ titulo: 'Historial de la secretaría', ancho: 560 });
      var verEntrega = function (id) { return id ? h('button.btn.chico.fantasma', { onclick: function () { hj2.cerrar(); if (App.Entregables && App.Entregables.abrir) App.Entregables.abrir(id); } }, 'Ver') : null; };
      var ESTADO_REP = { corriendo: 'Armándolo…', ok: 'Listo', fallida: 'Falló', incierta: 'Se cortó', salteado: 'Sin nada nuevo: no te dejó nada' };
      var linea = function (txt, boton) { return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderTop: '1px solid var(--linea)' } }, h('span', { style: { flex: 1 } }, txt), boton); };
      var reps = (datos.reportes || []).map(function (r) {
        return linea(App.hace(r.creada) + ' · ' + (ESTADO_REP[r.estado] || r.estado) + (r.estado === 'ok' && r.vacio ? ' · sin novedades' : '') + (r.manual ? ' · a pedido' : '') + (r.error ? ' (' + r.error + ')' : ''),
          verEntrega(r.estado === 'ok' && !r.vacio ? r.entrega : null));
      });
      var revs = (datos.revisiones || []).map(function (r) {
        var que = r.estado !== 'ok' ? '' : r.vacia ? ' · sin novedades' : r.urgente ? ' · avisó algo urgente' : r.reporte ? ' · ya en un reporte' : ' · para el próximo reporte';
        return linea(App.hace(r.creada) + ' · ' + (r.fuentes || []).map(function (f) { return NOMBRES_FUENTE[f] || f; }).join(', ') + ' · ' + (ESTADO_REV[r.estado] || r.estado) + que + (r.manual ? ' · a pedido' : '') + (r.error ? ' (' + r.error + ')' : ''),
          verEntrega(r.urgente ? r.entrega : null));
      });
      App.add(hj2.cuerpo,
        App.seccion('Reportes', reps.length ? reps : h('div.ajuste-ayuda', 'Todavía no dejó ninguno.')),
        App.seccion('Revisiones', revs.length ? revs : h('div.ajuste-ayuda', 'Todavía no revisó nada.')));
      App.add(hj2.pie, h('button.btn.primario', { onclick: hj2.cerrar }, 'Listo'));
    }

    /* WhatsApp: un renglón con el resumen; abierto, qué chats (chips) y cada cuánto */
    function bloqueWhatsApp(cfg) {
      var fWa = (cfg.fuentes || []).filter(function (f) { return f.id === 'whatsapp'; })[0];
      var estadoWa = fuente('whatsapp') || {};
      var vinculado = datos.whatsapp && datos.whatsapp !== 'apagado';
      var marcados = (fWa && fWa.chats) || chatsGuardados || [];
      var todos = datos.chatsWhatsApp || [];
      var todosWa = !!(fWa && fWa.todos);
      var cada = (fWa && fWa.cada) || { valor: 1, unidad: 'horas' };
      function guardarWa(cambio, texto) {
        var fuentes = (cfg.fuentes || []).filter(function (f) { return f.id !== 'whatsapp'; });
        fuentes.unshift(Object.assign({ id: 'whatsapp', cada: { valor: 1, unidad: 'horas' }, chats: marcados }, fWa || {}, cambio));
        return guardar({ fuentes: fuentes }, texto);
      }
      if (!vinculado) {
        return App.renglon({ marca: marcaFuente('whatsapp'), titulo: 'WhatsApp', sub: 'Sin vincular',
          control: h('button.btn.chico', { onclick: function () { App.Ajustes.abrir('whatsapp'); } }, 'Vincular') });
      }
      var n = todosWa ? null : marcados.length;
      var sub = (todosWa ? 'Todos los chats que se leen' : n ? n + (n === 1 ? ' chat' : ' chats') : 'Ningún chat todavía') + ' · cada ' + textoCada(cada);
      var problema = fWa && estadoWa.problema && (marcados.length || todosWa) ? estadoWa.problema : null;
      var on = App.interruptor(!!fWa, function (si) {
        if (si) guardarWa({}, 'Revisa WhatsApp.');
        else {
          chatsGuardados = marcados;
          guardar({ fuentes: (cfg.fuentes || []).filter(function (f) { return f.id !== 'whatsapp'; }) }, 'Ya no revisa WhatsApp.');
        }
      }, 'Revisar WhatsApp');
      var renglon = App.renglon({ marca: marcaFuente('whatsapp'), titulo: 'WhatsApp', sub: problema || sub, subError: !!problema, control: on,
        abierto: !!fWa && abierta === 'whatsapp', alTocar: fWa ? function () { alternar('whatsapp'); } : null });
      if (!fWa || abierta !== 'whatsapp') return renglon;

      var queChats = App.elegir({ forma: 'segmento', etiqueta: 'Qué chats revisa', valor: todosWa ? 'todos' : 'elijo',
        opciones: [{ valor: 'elijo', titulo: 'Los que elijo' }, { valor: 'todos', titulo: 'Todos los que se leen', sub: datos.whatsappLeerTodos ? 'Incluye los que entran solos con «Leer todos los chats individuales»' : 'Todos los elegidos en Ajustes › WhatsApp' }],
        alCambiar: function (v) { guardarWa({ todos: v === 'todos' }, v === 'todos' ? 'Revisa todos los chats que se leen.' : 'Revisa solo los chats que elijas.'); } });
      var cuerpo = [h('div.renglon-par', h('span.renglon-etq', 'Chats'), queChats)];
      if (!todosWa) {
        var porJid = {}; todos.forEach(function (c) { porJid[c.jid] = c; });
        var suyos = marcados.map(function (j) { return porJid[j] || { jid: j, nombre: j.split('@')[0] }; });
        var visibles = chipsTodos ? suyos : suyos.slice(0, 6);
        var chips = visibles.map(function (c) {
          return h('span.chip.chip-quitar', { title: c.grupo ? 'Grupo' : (c.numero || '') }, c.nombre,
            h('button.chip-x', { title: 'Dejar de revisar ' + c.nombre, onclick: function () {
              guardarWa({ chats: marcados.filter(function (j) { return j !== c.jid; }) }, 'Ya no revisa ' + c.nombre + '.');
            } }, '×'));
        });
        if (suyos.length > visibles.length) chips.push(h('button.chip.fijo', { onclick: function () { chipsTodos = true; dibujar(); } }, '+' + (suyos.length - visibles.length) + ' más'));
        var agregar = h('button.chip.agregar', { onclick: function () {
          var otros = todos.filter(function (c) { return marcados.indexOf(c.jid) < 0; });
          if (!otros.length) { App.aviso('No hay más chats para elegir.'); return; }
          App.menu(agregar, otros.slice(0, 300).map(function (c) {
            return { texto: c.nombre, nota: c.grupo ? 'grupo' : c.numero || '', icono: c.grupo ? 'personas' : 'charla', accion: function () {
              guardarWa({ chats: marcados.concat([c.jid]) }, 'Revisa también ' + c.nombre + ' (desde ahora).');
            } };
          }));
        } }, App.icono('mas'), 'Agregar');
        chips.push(agregar);
        cuerpo.push(h('div.chips-ed', chips));
        if (!suyos.length) cuerpo.push(h('div.nota-chica', 'Todavía no revisa ningún chat: tocá «Agregar» y buscá a quién (por ejemplo, «mamá»).'));
      }
      cuerpo.push(h('div.renglon-par', h('span.renglon-etq', 'Cada'),
        selectorCada(cada, function (c) { guardarWa({ cada: c }, 'Revisa WhatsApp cada ' + textoCada(c) + '.'); }),
        h('span.nota-chica', 'sin mensajes nuevos no gasta')));
      return [renglon, h('div.renglon-abierto', cuerpo)];
    }

    /* Una fuente de conector: prenderla (le asigna el conector a quien atiende), cada cuánto y una indicación */
    function bloqueConector(cfg, f) {
      var fc = (cfg.fuentes || []).filter(function (x) { return x.id === f.id; })[0];
      var cada = (fc && fc.cada) || { valor: f.id === 'calendario' ? 12 : 4, unidad: 'horas' };
      var guardarFuente = function (cambio, texto) {
        var resto = (cfg.fuentes || []).filter(function (x) { return x.id !== f.id; });
        if (cambio) {
          var nueva = { id: f.id, cada: cambio.cada || cada };
          var ind = cambio.indicacion !== undefined ? cambio.indicacion : fc && fc.indicacion;
          if (ind && ind.trim()) nueva.indicacion = ind.trim();
          resto.push(nueva);
        }
        return guardar({ fuentes: resto }, texto);
      };
      var on = App.interruptor(!!fc, function (si) { guardarFuente(si ? {} : null, si ? 'Revisa también ' + f.nombre + '.' : 'Ya no revisa ' + f.nombre + '.'); }, 'Revisar ' + f.nombre, !fc && !f.disponible);
      var sub = !f.disponible ? 'Conectalo en claude.ai y actualizá la lista en Ajustes › Conectores'
        : !fc ? 'No lo revisa'
        : 'cada ' + textoCada(cada) + (fc.indicacion ? ' · «' + fc.indicacion + '»' : f.id === 'calendario' ? ' · agenda de hoy y 48 h' : '');
      var problema = fc && f.problema ? f.problema : null;
      var abre = !!fc && f.disponible;
      var renglon = App.renglon({ marca: marcaFuente(f.id), titulo: f.nombre, sub: problema || sub, subError: !!problema, control: on,
        abierto: abre ? abierta === f.id : undefined, alTocar: abre ? function () { alternar(f.id); } : null });
      if (!abre || abierta !== f.id) return renglon;
      var ind = h('textarea.campo', { rows: 2, placeholder: f.id === 'gmail' ? 'Opcional. Por ejemplo: solo mails del banco, del colegio y de personas.' : 'Opcional. Por ejemplo: avisame también lo de la semana que viene.' });
      ind.value = fc.indicacion || '';
      ind.addEventListener('change', function () { guardarFuente({ indicacion: ind.value }, 'Indicación guardada.'); });
      return [renglon, h('div.renglon-abierto',
        h('div.renglon-par', h('span.renglon-etq', 'Cada'),
          selectorCada(cada, function (c) { guardarFuente({ cada: c }, 'Revisa ' + f.nombre + ' cada ' + textoCada(c) + '.'); }),
          f.id === 'gmail' ? h('span.nota-chica', 'usa Claude aunque no haya mails nuevos') : null),
        h('div.renglon-par', h('span.renglon-etq', 'Indicación'), h('div', { style: { flex: 1, minWidth: '200px' } }, ind)))];
    }

    /* A qué horas deja el reporte: chips con × y «+» que pide la hora */
    function renglonHoras(cfg) {
      var horas = ((cfg.reporte && cfg.reporte.horas) || ['09:00', '19:00']).slice();
      var guardarHoras = function (nuevas, texto) { return guardar({ reporte: { horas: nuevas } }, texto); };
      var chips = horas.map(function (hm) {
        return h('span.chip.chip-quitar', hm, horas.length > 1 ? h('button.chip-x', { title: 'Sacar las ' + hm, onclick: function () {
          guardarHoras(horas.filter(function (x) { return x !== hm; }), 'Ya no te deja el reporte a las ' + hm + '.');
        } }, '×') : null);
      });
      if (horas.length < 8) {
        var mas = h('button.chip.agregar', { title: 'Agregar una hora', onclick: function () {
          var hora = h('input.campo', { type: 'time', value: '13:00', style: { width: 'auto' } });
          var e = App.emergente(mas, h('div', { style: { display: 'flex', gap: '6px', padding: '8px' } }, hora,
            h('button.btn.chico.primario', { onclick: function () {
              if (!hora.value || horas.indexOf(hora.value) >= 0) { e.cerrar(); return; }
              e.cerrar(); guardarHoras(horas.concat([hora.value]), 'También te deja el reporte a las ' + hora.value + '.');
            } }, 'Agregar')));
          setTimeout(function () { hora.focus(); }, 0);
        } }, App.icono('mas'));
        chips.push(mas);
      }
      return App.renglon({ titulo: 'A las', apilar: true, control: h('div.chips-ed', chips) });
    }

    /* Franja para revisar: desde, hasta y un interruptor */
    function renglonFranja(cfg) {
      var desde = h('input.campo', { type: 'time', value: (cfg.franja && cfg.franja.desde) || '08:00', style: { width: 'auto' }, disabled: !cfg.franja });
      var hasta = h('input.campo', { type: 'time', value: (cfg.franja && cfg.franja.hasta) || '22:00', style: { width: 'auto' }, disabled: !cfg.franja });
      var prendida = !!cfg.franja;
      var poner = function () {
        guardar({ franja: prendida ? { desde: desde.value, hasta: hasta.value } : null },
          prendida ? 'Revisa solo entre las ' + desde.value + ' y las ' + hasta.value + '.' : 'Revisa a cualquier hora.');
      };
      desde.addEventListener('change', poner); hasta.addEventListener('change', poner);
      return App.renglon({ titulo: 'Revisar solo entre', sub: prendida ? 'Lo de afuera lo ve en la primera vuelta del día' : 'A cualquier hora', apilar: true,
        control: [desde, h('span.nota-chica', '–'), hasta, App.interruptor(prendida, function (si) { prendida = si; poner(); }, 'Revisar solo en un horario')] });
    }

    cargar();
  }

  /* ---------------- ficha del agente: un resumen ---------------- */
  function seccion(a) {
    var caja = h('div');
    api().get('/api/secretaria').then(function (r) {
      if (!r.config || r.config.agente !== a.id) return;
      caja.appendChild(App.seccion('Secretaría', App.ajuste('Atiende la secretaría', 'Revisa ' + r.config.fuentes.map(function (f) { return { whatsapp: 'WhatsApp', gmail: 'los mails', calendario: 'el calendario' }[f.id] || f.id; }).join(', ') + ' y te deja reportes en la bandeja.',
        h('button.btn', { onclick: function () { App.Ajustes.abrir('secretaria'); } }, 'Configurar'))));
    }).catch(function () {});
    return caja;
  }

  App.Secretaria = { pintar: pintar, seccion: seccion };
})();
