/* Secretaría (docs/plan-secretaria.md): Ajustes › Secretaría. Se contrata en un paso (tiene su despacho al lado del tuyo, ya
   configurada con los chats elegidos de WhatsApp y, si están conectados, Gmail y el calendario) y se configura todo acá:
   qué chats revisa (de la lista completa: elegir uno acá lo elige también en Ajustes › WhatsApp), cada cuánto, Gmail y
   Calendario (prenderlos le asigna el conector), la franja horaria y «Revisar ahora». En la ficha del agente queda un
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
    var caja = h('div', App.cargando('Mirando la secretaría…'));
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

    /* ---- con secretaría ---- */
    function dibujarConfig(cfg) {
      var ag = datos.agente;
      var fWa = (cfg.fuentes || []).filter(function (f) { return f.id === 'whatsapp'; })[0];
      var estadoWa = fuente('whatsapp') || {};

      /* quién, y si revisa sola */
      var activa = h('input', { type: 'checkbox', checked: cfg.activa });
      activa.addEventListener('change', function () { guardar({ activa: activa.checked }, activa.checked ? 'La secretaría vuelve a revisar.' : 'La secretaría queda en pausa.'); });
      caja.appendChild(App.ajuste(ag.nombre + ' atiende la secretaría', 'Desde la secretaría revisa lo que llega y te deja un reporte en la bandeja. Lo que propone (por ejemplo, un evento en el calendario) no se hace hasta que lo aprobás.',
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' } },
          h('label.ajuste-check', activa, h('span', 'Revisa sola')),
          h('button.btn.chico', { onclick: function () { if (App.Agente) App.Agente.abrir(ag.id, 'chat'); } }, App.icono('charla'), 'Charlar'))));

      /* una secretaría armada antes de que existiera su despacho: ofrecer pasarla, y sacarle el permiso que ya no usa */
      if (ag.departamento !== 'recepcion' || (ag.permisos || []).indexOf('whatsapp') >= 0) {
        var acomodar = h('button.btn', { onclick: function () {
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
        if ((ag.permisos || []).indexOf('whatsapp') >= 0) por.push('le saca «Puede leer WhatsApp», que ya no hace falta (lee los chats que elijas acá)');
        caja.appendChild(App.ajuste('Acomodar a ' + ag.nombre, 'La secretaría ahora tiene su despacho al lado del tuyo. Con esto ' + por.join(' y ') + '.', acomodar));
      }

      /* WhatsApp: elegir chats de la lista completa y cada cuánto */
      var marcados = (fWa && fWa.chats) || [];
      function guardarWa(cambio, texto) {
        var fuentes = (cfg.fuentes || []).filter(function (f) { return f.id !== 'whatsapp'; });
        fuentes.unshift(Object.assign({ id: 'whatsapp', cada: { valor: 1, unidad: 'horas' }, chats: marcados }, fWa || {}, cambio));
        return guardar({ fuentes: fuentes }, texto);
      }
      var bloqueWa = h('div.ajuste', { style: { display: 'block' } }, h('div.ajuste-tit', 'WhatsApp'));
      if (!datos.whatsapp || datos.whatsapp === 'apagado') {
        bloqueWa.appendChild(h('div.ajuste-ayuda', 'WhatsApp no está vinculado. ',
          h('a', { href: '#', onclick: function (ev) { ev.preventDefault(); App.Ajustes.abrir('whatsapp'); } }, 'Vinculalo en Ajustes › WhatsApp'), ' y volvé acá a elegir los chats.'));
      } else {
        var todos = datos.chatsWhatsApp || [];
        var lista = h('div', { style: { maxHeight: '240px', overflowY: 'auto', marginTop: '6px' } });
        var buscar = h('input.campo', { placeholder: 'Buscar un chat por nombre o número', value: filtro, style: { width: '100%' } });
        buscar.addEventListener('input', function () { filtro = buscar.value; llenar(); });
        function llenar() {
          App.vaciar(lista);
          var q = filtro.trim().toLowerCase();
          var suyos = todos.filter(function (c) { return marcados.indexOf(c.jid) >= 0; });
          var otros = todos.filter(function (c) { return marcados.indexOf(c.jid) < 0 && (!q || [c.nombre, c.numero].some(function (x) { return x && String(x).toLowerCase().indexOf(q) >= 0; })); });
          suyos.concat(q ? otros.slice(0, 40) : []).forEach(function (c) {
            var ck = h('input', { type: 'checkbox', checked: marcados.indexOf(c.jid) >= 0 });
            ck.addEventListener('change', function () {
              var nuevos = marcados.filter(function (j) { return j !== c.jid; }).concat(ck.checked ? [c.jid] : []);
              filtro = ''; guardarWa({ chats: nuevos }, ck.checked ? 'Revisa también ' + c.nombre + ' (desde ahora).' : 'Ya no revisa ' + c.nombre + '.');
            });
            lista.appendChild(h('label.ajuste-check', { style: { display: 'flex', padding: '3px 0' } }, ck,
              h('span', c.nombre + (c.grupo ? ' (grupo)' : '')), h('span.ajuste-ayuda', { style: { marginLeft: '6px' } }, c.ultimo ? App.hace(c.ultimo) : '')));
          });
          if (!suyos.length && !q) lista.appendChild(h('div.ajuste-ayuda', 'Todavía no revisa ningún chat: buscá a quién (por ejemplo, «mamá») y marcalo.'));
          if (q && !otros.length) lista.appendChild(h('div.ajuste-ayuda', 'Nada con «' + filtro + '».'));
        }
        llenar();
        /* revisar todos los chats que se leen (para un negocio: con «leer todos los chats individuales», también los que entran solos) */
        var todosWa = !!(fWa && fWa.todos);
        var ckTodos = h('input', { type: 'checkbox', checked: todosWa });
        ckTodos.addEventListener('change', function () {
          guardarWa({ todos: ckTodos.checked }, ckTodos.checked ? 'Revisa todos los chats que se leen.' : 'Revisa solo los chats que marques.');
        });
        var lineaTodos = h('div', { style: { margin: '2px 0 8px' } },
          h('label.ajuste-check', { style: { display: 'flex' } }, ckTodos, h('span', 'Revisar todos los chats que se leen')),
          h('div.ajuste-ayuda', datos.whatsappLeerTodos
            ? 'Incluye los que entran solos porque en Ajustes › WhatsApp está prendido «Leer todos los chats individuales» (por ejemplo, clientes que no tenés agendados).'
            : 'Todos los elegidos en Ajustes › WhatsApp. Si te escriben números que no tenés agendados (por ejemplo, clientes de un negocio), prendé «Leer todos los chats individuales» allá.'));
        if (todosWa) { buscar.style.display = 'none'; lista.style.display = 'none'; }
        var cada = (fWa && fWa.cada) || { valor: 1, unidad: 'horas' };
        var valor = h('input.campo', { type: 'number', min: 1, value: cada.valor, style: { width: '70px' } });
        var unidad = h('select.campo', { style: { width: 'auto' } }, h('option', { value: 'minutos', selected: cada.unidad === 'minutos' }, 'minutos'), h('option', { value: 'horas', selected: cada.unidad === 'horas' }, 'horas'));
        var cambiarCada = function () {
          var v = Math.floor(Number(valor.value));
          if (!(v > 0)) { valor.value = cada.valor; return; }
          guardarWa({ cada: { valor: v, unidad: unidad.value } }, 'Revisa WhatsApp cada ' + v + ' ' + unidad.value + '.');
        };
        valor.addEventListener('change', cambiarCada); unidad.addEventListener('change', cambiarCada);
        App.add(bloqueWa,
          h('div.ajuste-ayuda', { style: { marginBottom: '6px' } }, 'Qué chats revisa. Se leen desde que los marcás; nunca manda mensajes.'),
          lineaTodos, buscar, lista,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } }, h('span', 'Revisar cada'), valor, unidad,
            h('span.ajuste-ayuda', '(si no llegó nada nuevo, no gasta)')),
          estadoWa.problema && (marcados.length || todosWa) ? h('div.ajuste-ayuda', { style: { color: 'var(--peligro)', marginTop: '6px' } }, estadoWa.problema) : null);
      }
      caja.appendChild(bloqueWa);

      /* Gmail y Calendario */
      (datos.fuentes || []).filter(function (f) { return f.tipo === 'conector'; }).forEach(function (f) { caja.appendChild(bloqueConector(cfg, f)); });

      /* el reporte: a qué horas junta todo */
      caja.appendChild(bloqueReporte(cfg));

      /* franja para revisar */
      var conFranja = h('input', { type: 'checkbox', checked: !!cfg.franja });
      var desde = h('input.campo', { type: 'time', value: (cfg.franja && cfg.franja.desde) || '08:00', style: { width: 'auto' }, disabled: !cfg.franja });
      var hasta = h('input.campo', { type: 'time', value: (cfg.franja && cfg.franja.hasta) || '22:00', style: { width: 'auto' }, disabled: !cfg.franja });
      var cambiarFranja = function () {
        desde.disabled = hasta.disabled = !conFranja.checked;
        guardar({ franja: conFranja.checked ? { desde: desde.value, hasta: hasta.value } : null },
          conFranja.checked ? 'Revisa solo entre las ' + desde.value + ' y las ' + hasta.value + '.' : 'Revisa a cualquier hora.');
      };
      conFranja.addEventListener('change', cambiarFranja); desde.addEventListener('change', cambiarFranja); hasta.addEventListener('change', cambiarFranja);
      caja.appendChild(h('div.ajuste', { style: { display: 'block' } },
        h('label.ajuste-check', conFranja, h('span', 'Revisar solo entre'), desde, h('span', 'y'), hasta),
        h('div.ajuste-ayuda', { style: { margin: '2px 0 0' } }, 'Lo que llegue fuera de ese horario lo revisa en la primera vuelta del día. El reporte sale igual a sus horas.')));

      /* revisar ahora, últimas revisiones y cerrar */
      var err = h('div.error-txt');
      var ahora = h('button.btn.primario', { disabled: datos.corriendo, onclick: function () {
        ahora.disabled = true; err.textContent = '';
        api().post('/api/secretaria/revisar', {}).then(function (r) {
          App.guardado(r.motivo || ag.nombre + ' está revisando.');
          return cargar();
        }).catch(function (e) { err.textContent = e.message; ahora.disabled = false; });
      } }, datos.corriendo ? 'Revisando…' : 'Revisar ahora');
      ahora.disabled = !!(datos.corriendo || datos.reporteCorriendo);
      var verEntrega = function (id) { return id ? h('button.btn.chico.fantasma', { onclick: function () { if (App.Entregables && App.Entregables.abrir) App.Entregables.abrir(id); } }, 'Ver') : null; };
      var revs = (datos.revisiones || []).slice(0, 5).map(function (r) {
        var nombres = { whatsapp: 'WhatsApp', gmail: 'Gmail', calendario: 'Calendario' };
        var que = r.estado !== 'ok' ? '' : r.vacia ? ' · sin novedades' : r.urgente ? ' · avisó algo urgente' : r.reporte ? ' · ya en un reporte' : ' · para el próximo reporte';
        var txt = (r.fuentes || []).map(function (f) { return nombres[f] || f; }).join(', ') + ' · ' + (ESTADO_REV[r.estado] || r.estado) + que + (r.manual ? ' · a pedido' : '');
        return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0' } },
          h('span.ajuste-ayuda', { style: { flex: 1 } }, App.hace(r.creada) + ' · ' + txt + (r.error ? ' (' + r.error + ')' : '')), verEntrega(r.urgente ? r.entrega : null));
      });
      var ESTADO_REP = { corriendo: 'Armándolo…', ok: 'Listo', fallida: 'Falló', incierta: 'Se cortó', salteado: 'Sin nada nuevo: no te dejó nada' };
      var reps = (datos.reportes || []).slice(0, 4).map(function (r) {
        var txt = (ESTADO_REP[r.estado] || r.estado) + (r.estado === 'ok' && r.vacio ? ' · sin novedades' : '') + (r.manual ? ' · a pedido' : '');
        return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0' } },
          h('span.ajuste-ayuda', { style: { flex: 1 } }, App.hace(r.creada) + ' · ' + txt + (r.error ? ' (' + r.error + ')' : '')), verEntrega(r.estado === 'ok' && !r.vacio ? r.entrega : null));
      });
      var armar = h('button.btn', { disabled: datos.corriendo || datos.reporteCorriendo, title: 'Arma el reporte con lo que ya revisó, sin esperar al horario', onclick: function () {
        armar.disabled = true; err.textContent = '';
        api().post('/api/secretaria/reportar', {}).then(function (r) {
          App.guardado(r.motivo || ag.nombre + ' está armando el reporte.');
          return cargar();
        }).catch(function (e) { err.textContent = e.message; armar.disabled = false; });
      } }, datos.reporteCorriendo ? 'Armando el reporte…' : 'Armar el reporte ahora');
      caja.appendChild(h('div.ajuste', { style: { display: 'block' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, ahora, armar, h('span.ajuste-ayuda', { style: { flex: 1 } }, textoNovedades(estadoWa))),
        h('div.ajuste-ayuda', { style: { marginTop: '6px' } }, '«Revisar ahora» mira todo y enseguida te deja el reporte. ' +
          (datos.sinReportar ? (datos.sinReportar === 1 ? 'Hay 1 revisión' : 'Hay ' + datos.sinReportar + ' revisiones') + ' esperando el próximo reporte.' : 'No hay nada esperando el próximo reporte.')),
        err,
        reps.length ? h('div', { style: { marginTop: '8px' } }, h('div.ajuste-tit', { style: { fontSize: '12px' } }, 'Últimos reportes'), reps) : null,
        revs.length ? h('div', { style: { marginTop: '8px' } }, h('div.ajuste-tit', { style: { fontSize: '12px' } }, 'Últimas revisiones'), revs) : null));
      /* memoria privada de la secretaría (secretaria-memoria.js) */
      if (App.SecretariaMemoria) caja.appendChild(App.SecretariaMemoria.bloque(true));
      caja.appendChild(h('div', { style: { marginTop: '16px' } }, h('button.btn.chico.fantasma', { onclick: function () {
        App.confirmar('¿Cerrar la secretaría?', ag.nombre + ' deja de revisar (sigue en la oficina; si querés, despedilo desde su ficha). Los reportes que ya dejó quedan en la bandeja, y su memoria también (podés borrarla desde «Memoria»).', 'Cerrar', true).then(function (si) {
          if (si) guardar({ agente: null }, 'La oficina ya no tiene secretaría.');
        });
      } }, 'Cerrar la secretaría')));
    }

    function textoNovedades(estadoWa) {
      var conectores = (datos.fuentes || []).filter(function (f) { return f.tipo === 'conector' && f.activa && !f.problema; }).map(function (f) { return f.nombre; });
      var wa = estadoWa.activa ? (estadoWa.novedades ? 'Hay mensajes de WhatsApp sin revisar.' : 'Nada nuevo en WhatsApp.') : '';
      return (wa + (conectores.length ? ' ' + conectores.join(' y ') + (conectores.length > 1 ? ' se miran' : ' se mira') + ' siempre.' : '')).trim();
    }

    /* El reporte: a qué horas junta lo revisado (chips con las horas, agregar y sacar) y si lo deja aunque no haya nada */
    function bloqueReporte(cfg) {
      var horas = ((cfg.reporte && cfg.reporte.horas) || ['09:00', '19:00']).slice();
      var guardarHoras = function (nuevas, texto) { return guardar({ reporte: { horas: nuevas } }, texto); };
      var chips = horas.map(function (hm) {
        return h('span.insignia', { style: { height: '28px', fontSize: '13px', gap: '6px', paddingRight: '4px' } }, hm,
          horas.length > 1 ? h('button.btn.chico.fantasma.icono', { title: 'Sacar las ' + hm, style: { height: '20px', width: '20px', padding: 0 }, onclick: function () {
            guardarHoras(horas.filter(function (x) { return x !== hm; }), 'Ya no te deja el reporte a las ' + hm + '.');
          } }, App.icono('cerrar')) : null);
      });
      var nueva = h('input.campo', { type: 'time', value: '13:00', style: { width: 'auto' } });
      var agregar = h('button.btn.chico', { disabled: horas.length >= 8, onclick: function () {
        if (!nueva.value || horas.indexOf(nueva.value) >= 0) return;
        guardarHoras(horas.concat([nueva.value]), 'También te deja el reporte a las ' + nueva.value + '.');
      } }, App.icono('mas'), 'Agregar');
      var vacio = h('input', { type: 'checkbox', checked: cfg.reporteVacio });
      vacio.addEventListener('change', function () { guardar({ reporteVacio: vacio.checked }, vacio.checked ? 'Te deja el reporte aunque no haya novedades.' : 'Sin novedades, no te deja reporte.'); });
      var prox = datos.proximoReporte ? new Date(datos.proximoReporte * 1000) : null;
      var proxTxt = prox ? (prox.toDateString() === new Date().toDateString() ? 'hoy' : 'mañana') + ' a las ' + prox.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
      return h('div.ajuste', { style: { display: 'block' } },
        h('div.ajuste-tit', 'Reporte'),
        h('div.ajuste-ayuda', { style: { margin: '2px 0 8px' } }, 'Cada fuente se revisa con su intervalo, sin dejarte nada en la bandeja. A estas horas te deja un solo reporte con lo que juntó desde el anterior; si no hubo nada nuevo, no te deja nada. Lo urgente y lo que te propone hacer te llega enseguida.'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } }, chips, nueva, agregar),
        proxTxt ? h('div.ajuste-ayuda', { style: { marginTop: '6px' } }, 'Próximo reporte: ' + proxTxt + '.') : null,
        h('label.ajuste-check', { style: { marginTop: '8px' } }, vacio, h('span', 'Dejar el reporte aunque no haya novedades')));
    }

    /* Una fuente de conector: prenderla (le asigna el conector a quien atiende), cada cuánto y una indicación */
    function bloqueConector(cfg, f) {
      var fc = (cfg.fuentes || []).filter(function (x) { return x.id === f.id; })[0];
      var on = h('input', { type: 'checkbox', checked: !!fc, disabled: !fc && !f.disponible });
      var cada = (fc && fc.cada) || { valor: f.id === 'calendario' ? 12 : 4, unidad: 'horas' };
      var valor = h('input.campo', { type: 'number', min: 1, value: cada.valor, style: { width: '70px' } });
      var unidad = h('select.campo', { style: { width: 'auto' } }, h('option', { value: 'minutos', selected: cada.unidad === 'minutos' }, 'minutos'), h('option', { value: 'horas', selected: cada.unidad === 'horas' }, 'horas'));
      var ind = h('textarea.campo', { rows: 2, placeholder: f.id === 'gmail' ? 'Opcional. Por ejemplo: solo mails del banco, del colegio y de personas.' : 'Opcional. Por ejemplo: avisame también lo de la semana que viene.' });
      ind.value = (fc && fc.indicacion) || '';
      var guardarFuente = function (texto) {
        var resto = (cfg.fuentes || []).filter(function (x) { return x.id !== f.id; });
        if (on.checked) {
          var v = Math.floor(Number(valor.value)); if (!(v > 0)) v = cada.valor;
          var nueva = { id: f.id, cada: { valor: v, unidad: unidad.value } };
          if (ind.value.trim()) nueva.indicacion = ind.value.trim();
          resto.push(nueva);
        }
        return guardar({ fuentes: resto }, texto);
      };
      on.addEventListener('change', function () { guardarFuente(on.checked ? 'Revisa también ' + f.nombre + '.' : 'Ya no revisa ' + f.nombre + '.'); });
      valor.addEventListener('change', function () { guardarFuente('Revisa ' + f.nombre + ' cada ' + valor.value + ' ' + unidad.value + '.'); });
      unidad.addEventListener('change', function () { guardarFuente('Revisa ' + f.nombre + ' cada ' + valor.value + ' ' + unidad.value + '.'); });
      ind.addEventListener('change', function () { guardarFuente('Indicación guardada.'); });
      var ayuda = f.id === 'gmail' ? 'Mira los mails que llegaron desde la revisión anterior y anota lo que importa para el reporte. Cada revisión de Gmail usa Claude aunque no haya mails nuevos: conviene cada varias horas.'
        : 'Arma la agenda de hoy y las próximas 48 horas para el reporte y puede proponerte eventos.';
      var nota = !f.disponible ? h('div.ajuste-ayuda', { style: { marginTop: '6px' } }, 'Conectá ' + f.nombre + ' en tu cuenta de claude.ai y actualizá la lista en Ajustes › Conectores.')
        : fc && f.problema ? h('div.ajuste-ayuda', { style: { color: 'var(--peligro)', marginTop: '6px' } }, f.problema) : null;
      return h('div.ajuste', { style: { display: 'block' } },
        h('label.ajuste-check', on, h('span', { style: { fontWeight: 500 } }, f.nombre)),
        h('div.ajuste-ayuda', { style: { margin: '2px 0 6px' } }, ayuda),
        fc ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, h('span', 'Revisar cada'), valor, unidad) : null,
        fc ? h('div', { style: { marginTop: '8px' } }, ind) : null,
        nota);
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
