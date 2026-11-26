/* Secretaría (docs/plan-secretaria.md, fase S2): sección de la ficha del agente. Un agente de la oficina atiende la
   secretaría: revisa sus fuentes (por ahora, chats de WhatsApp) cada cierto tiempo o cuando se le pide y deja un reporte
   en la bandeja con sugerencias para aprobar. API: GET/PUT /api/secretaria, POST /api/secretaria/revisar.
   Todo se guarda al tocarlo. */
(function () {
  var h = App.h;
  var api = function () { return App.api; };

  var ESTADO_REV = { corriendo: 'Revisando…', ok: 'Lista', fallida: 'Falló', incierta: 'Se cortó' };

  function seccion(a) {
    var caja = h('div', App.cargando('Mirando la secretaría…'));
    var datos = null, reloj = null;
    function cargar() {
      return api().get('/api/secretaria').then(function (r) { datos = r; pintar(); })
        .catch(function (e) { App.vaciar(caja).appendChild(h('div.error-txt', e.message)); });
    }
    function guardar(cambios, texto) {
      return api().put('/api/secretaria', cambios).then(function (r) {
        datos = r; pintar();
        if (texto) App.guardado(texto);
        if (App.recargarOficina) App.recargarOficina();
      }).catch(function (e) { App.fallo(e); pintar(); });
    }

    function pintar() {
      clearTimeout(reloj);
      App.vaciar(caja);
      var cfg = datos.config;
      if (!cfg) {
        caja.appendChild(App.ajuste('Secretaría', 'Revisa tus chats de WhatsApp cada cierto tiempo y te deja un reporte en la bandeja, con sugerencias (por ejemplo, agendar un turno) que vos aprobás.',
          h('button.btn', { onclick: function () { guardar({ agente: a.id }, a.nombre + ' atiende la secretaría.'); } }, 'Que atienda la secretaría')));
        return;
      }
      if (cfg.agente !== a.id) {
        var otro = datos.agente ? datos.agente.nombre : cfg.agente;
        caja.appendChild(App.ajuste('Secretaría', 'La atiende ' + otro + '. Puede haber una sola por oficina.',
          h('button.btn', { onclick: function () { guardar({ agente: a.id }, 'Ahora la secretaría la atiende ' + a.nombre + '.'); } }, 'Pasársela a ' + a.nombre)));
        return;
      }
      pintarPropia(cfg);
      if (datos.corriendo) reloj = setTimeout(function () { if (caja.isConnected) cargar(); }, 3000);
    }

    function pintarPropia(cfg) {
      var fWa = (cfg.fuentes || []).filter(function (f) { return f.id === 'whatsapp'; })[0];
      var estadoWa = (datos.fuentes || []).filter(function (f) { return f.id === 'whatsapp'; })[0] || {};

      /* revisando / en pausa */
      var activa = h('input', { type: 'checkbox', checked: cfg.activa });
      activa.addEventListener('change', function () { guardar({ activa: activa.checked }, activa.checked ? 'La secretaría vuelve a revisar.' : 'La secretaría queda en pausa.'); });
      caja.appendChild(App.ajuste('Secretaría', a.nombre + ' revisa lo que llega y te deja un reporte en la bandeja. Lo que propone (por ejemplo, un evento en el calendario) no se hace hasta que lo aprobás.',
        h('label.ajuste-check', activa, h('span', 'Revisa sola'))));

      /* WhatsApp: chats y cada cuánto */
      var elegidos = datos.chatsWhatsApp || [];
      var marcados = (fWa && fWa.chats) || [];
      var chats = elegidos.length
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, elegidos.map(function (c) {
            var ck = h('input', { type: 'checkbox', checked: marcados.indexOf(c.jid) >= 0 });
            ck.addEventListener('change', function () {
              var nuevos = marcados.filter(function (j) { return j !== c.jid; }).concat(ck.checked ? [c.jid] : []);
              guardarWa({ chats: nuevos }, ck.checked ? 'Revisa también ' + c.nombre + '.' : 'Ya no revisa ' + c.nombre + '.');
            });
            return h('label.ajuste-check', ck, h('span', c.nombre + (c.grupo ? ' (grupo)' : '')));
          }))
        : h('div.ajuste-ayuda', 'Todavía no elegiste chats de WhatsApp. ', h('a', { href: '#', onclick: function (ev) { ev.preventDefault(); if (App.Ajustes && App.Ajustes.abrir) App.Ajustes.abrir('whatsapp'); } }, 'Elegilos en Ajustes › WhatsApp'), '.');
      var cada = (fWa && fWa.cada) || { valor: 1, unidad: 'horas' };
      var valor = h('input.campo', { type: 'number', min: 1, max: cada.unidad === 'horas' ? 24 : 1440, value: cada.valor, style: { width: '70px' } });
      var unidad = h('select.campo', { style: { width: 'auto' } }, h('option', { value: 'minutos', selected: cada.unidad === 'minutos' }, 'minutos'), h('option', { value: 'horas', selected: cada.unidad === 'horas' }, 'horas'));
      function cambiarCada() {
        var v = Math.floor(Number(valor.value));
        if (!(v > 0)) { valor.value = cada.valor; return; }
        guardarWa({ cada: { valor: v, unidad: unidad.value } }, 'Revisa WhatsApp cada ' + v + ' ' + unidad.value + '.');
      }
      valor.addEventListener('change', cambiarCada); unidad.addEventListener('change', cambiarCada);
      function guardarWa(cambio, texto) {
        var fuentes = (cfg.fuentes || []).filter(function (f) { return f.id !== 'whatsapp'; });
        fuentes.unshift(Object.assign({ id: 'whatsapp', cada: cada, chats: marcados }, fWa || {}, cambio));
        return guardar({ fuentes: fuentes }, texto);
      }
      var problema = estadoWa.problema ? h('div.ajuste-ayuda', { style: { color: 'var(--peligro)', marginTop: '6px' } }, estadoWa.problema) : null;
      caja.appendChild(h('div.ajuste', { style: { display: 'block' } },
        h('div.ajuste-tit', 'WhatsApp'),
        h('div.ajuste-ayuda', { style: { marginBottom: '6px' } }, 'Qué chats revisa. Solo lee: nunca manda mensajes.'),
        chats,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } }, h('span', 'Revisar cada'), valor, unidad,
          h('span.ajuste-ayuda', '(entre 5 minutos y 24 horas; si no llegó nada nuevo, no gasta)')),
        problema));

      /* fuentes de conector (Gmail, Calendario): las lee el agente con sus conectores de claude.ai */
      (datos.fuentes || []).filter(function (f) { return f.tipo === 'conector'; }).forEach(function (f) {
        caja.appendChild(bloqueConector(cfg, f));
      });

      /* franja horaria */
      var conFranja = h('input', { type: 'checkbox', checked: !!cfg.franja });
      var desde = h('input.campo', { type: 'time', value: (cfg.franja && cfg.franja.desde) || '08:00', style: { width: 'auto' }, disabled: !cfg.franja });
      var hasta = h('input.campo', { type: 'time', value: (cfg.franja && cfg.franja.hasta) || '22:00', style: { width: 'auto' }, disabled: !cfg.franja });
      function cambiarFranja() {
        desde.disabled = hasta.disabled = !conFranja.checked;
        guardar({ franja: conFranja.checked ? { desde: desde.value, hasta: hasta.value } : null },
          conFranja.checked ? 'Revisa solo entre las ' + desde.value + ' y las ' + hasta.value + '.' : 'Revisa a cualquier hora.');
      }
      conFranja.addEventListener('change', cambiarFranja); desde.addEventListener('change', cambiarFranja); hasta.addEventListener('change', cambiarFranja);
      var vacio = h('input', { type: 'checkbox', checked: cfg.reporteVacio });
      vacio.addEventListener('change', function () { guardar({ reporteVacio: vacio.checked }); });
      caja.appendChild(h('div.ajuste', { style: { display: 'block' } },
        h('label.ajuste-check', conFranja, h('span', 'Solo entre'), desde, h('span', 'y'), hasta),
        h('div.ajuste-ayuda', { style: { margin: '2px 0 8px' } }, 'Lo que llegue fuera de ese horario lo revisa en la primera vuelta del día.'),
        h('label.ajuste-check', vacio, h('span', 'Dejar el reporte en la bandeja aunque no haya novedades'))));

      /* revisar ahora y últimas revisiones */
      var err = h('div.error-txt');
      var ahora = h('button.btn.primario', { disabled: datos.corriendo, onclick: function () {
        ahora.disabled = true; err.textContent = '';
        api().post('/api/secretaria/revisar', {}).then(function (r) {
          if (r.motivo) App.guardado(r.motivo); else App.guardado(a.nombre + ' está revisando.');
          return cargar();
        }).catch(function (e) { err.textContent = e.message; ahora.disabled = false; });
      } }, datos.corriendo ? 'Revisando…' : 'Revisar ahora');
      var revs = (datos.revisiones || []).slice(0, 5).map(function (r) {
        var txt = (ESTADO_REV[r.estado] || r.estado) + (r.estado === 'ok' ? (r.vacia ? ' · sin novedades' : ' · con reporte') : '') + (r.manual ? ' · a pedido' : '');
        var ver = r.entrega ? h('button.btn.chico.fantasma', { onclick: function () { if (App.Entregables && App.Entregables.abrir) App.Entregables.abrir(r.entrega); } }, 'Ver') : null;
        return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0' } },
          h('span.ajuste-ayuda', { style: { flex: 1 } }, App.hace(r.creada) + ' · ' + txt + (r.error ? ' (' + r.error + ')' : '')), ver);
      });
      caja.appendChild(h('div.ajuste', { style: { display: 'block' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, ahora,
          h('span.ajuste-ayuda', { style: { flex: 1 } }, estadoWa.novedades ? 'Hay mensajes nuevos sin revisar.' : 'No hay nada nuevo desde la última revisión.')),
        err,
        revs.length ? h('div', { style: { marginTop: '8px' } }, h('div.ajuste-tit', { style: { fontSize: '12px' } }, 'Últimas revisiones'), revs) : null,
        h('div', { style: { marginTop: '10px' } }, h('button.btn.chico.fantasma', { onclick: function () {
          App.confirmar('¿Cerrar la secretaría?', a.nombre + ' deja de revisar. Los reportes que ya dejó quedan en la bandeja.', 'Cerrar', true).then(function (si) {
            if (si) guardar({ agente: null }, 'La oficina ya no tiene secretaría.');
          });
        } }, 'Cerrar la secretaría'))));
    }

    /* Una fuente de conector: prenderla, cada cuánto y una indicación («solo mails del banco y del colegio») */
    function bloqueConector(cfg, f) {
      var fc = (cfg.fuentes || []).filter(function (x) { return x.id === f.id; })[0];
      var on = h('input', { type: 'checkbox', checked: !!fc });
      var cada = (fc && fc.cada) || { valor: f.id === 'calendario' ? 12 : 4, unidad: 'horas' };
      var valor = h('input.campo', { type: 'number', min: 1, value: cada.valor, style: { width: '70px' }, disabled: !fc });
      var unidad = h('select.campo', { style: { width: 'auto' }, disabled: !fc }, h('option', { value: 'minutos', selected: cada.unidad === 'minutos' }, 'minutos'), h('option', { value: 'horas', selected: cada.unidad === 'horas' }, 'horas'));
      var ind = h('textarea.campo', { rows: 2, disabled: !fc, placeholder: f.id === 'gmail' ? 'Opcional. Por ejemplo: solo mails del banco, del colegio y de personas.' : 'Opcional. Por ejemplo: avisame también lo de la semana que viene.' });
      ind.value = (fc && fc.indicacion) || '';
      function guardarFuente(texto) {
        var resto = (cfg.fuentes || []).filter(function (x) { return x.id !== f.id; });
        if (on.checked) {
          var v = Math.floor(Number(valor.value)); if (!(v > 0)) v = cada.valor;
          var nueva = { id: f.id, cada: { valor: v, unidad: unidad.value } };
          if (ind.value.trim()) nueva.indicacion = ind.value.trim();
          resto.push(nueva);
        }
        return guardar({ fuentes: resto }, texto);
      }
      on.addEventListener('change', function () { guardarFuente(on.checked ? 'Revisa también ' + f.nombre + '.' : 'Ya no revisa ' + f.nombre + '.'); });
      valor.addEventListener('change', function () { guardarFuente('Revisa ' + f.nombre + ' cada ' + valor.value + ' ' + unidad.value + '.'); });
      unidad.addEventListener('change', function () { guardarFuente('Revisa ' + f.nombre + ' cada ' + valor.value + ' ' + unidad.value + '.'); });
      ind.addEventListener('change', function () { guardarFuente('Indicación guardada.'); });
      var ayuda = f.id === 'gmail' ? 'Mira los mails que llegaron desde la revisión anterior y te cuenta lo que importa. Cada revisión de Gmail usa Claude aunque no haya mails nuevos: conviene revisarlo cada varias horas.'
        : 'Arma la agenda de lo que viene (hoy y las próximas 48 horas) y te avisa lo nuevo o lo que cambió.';
      var problema = fc && f.problema ? h('div.ajuste-ayuda', { style: { color: 'var(--peligro)', marginTop: '6px' } }, f.problema)
        : !fc && !f.disponible ? h('div.ajuste-ayuda', { style: { marginTop: '6px' } }, 'Conectá ' + f.nombre + ' en claude.ai y asignáselo a ' + a.nombre + ' en su ficha (Permisos).') : null;
      return h('div.ajuste', { style: { display: 'block' } },
        h('label.ajuste-check', on, h('span', { style: { fontWeight: 500 } }, f.nombre)),
        h('div.ajuste-ayuda', { style: { margin: '2px 0 6px' } }, ayuda),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, h('span', 'Revisar cada'), valor, unidad),
        h('div', { style: { marginTop: '8px' } }, ind),
        problema);
    }

    cargar();
    return App.seccion('Secretaría', caja);
  }

  App.Secretaria = { seccion: seccion };
})();
