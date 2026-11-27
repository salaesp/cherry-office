/* Ajustes › WhatsApp (docs/plan-secretaria.md, fase S1): vincular por QR, elegir qué chats se leen y desvincular.
   La conexión es de toda la app (hay un solo WhatsApp). Qué agente lee estos chats se decide en su ficha
   («Puede leer WhatsApp»). API: GET /api/whatsapp, GET /api/whatsapp/qr, POST /api/whatsapp/vincular,
   POST /api/whatsapp/desvincular, PUT /api/whatsapp/ajustes (transcripción: modelo e idioma), POST /api/whatsapp/chats,
   PUT /api/whatsapp/chats/:jid (en un grupo, `solo`: a quiénes se lee). «Leer todos los chats individuales» (`leerTodos` en
   PUT /api/whatsapp/ajustes): para un negocio que no tiene agendados a quienes le escriben; cada chat individual nuevo se
   elige solo (`auto`) desde su primer mensaje. Conectado: una sola lista con los chats que se leen; el buscador encuentra
   también los demás (con «Leer») y agrega números que no están, y «Elegir más chats» despliega el resto. */
(function () {
  var h = App.h;
  var api = function () { return App.api; };

  var RIESGOS = [
    ['Va contra las reglas de WhatsApp.', 'La oficina se conecta como un dispositivo vinculado no oficial. Aunque solo lee (nunca manda mensajes ni marca como leído), WhatsApp puede bloquear el número, y se pierde entero. Conviene probar primero con un número que no sea el principal.'],
    ['Lo que te escriben otras personas pasa por Claude.', 'Solo se guardan los chats que elijas, desde el momento en que los elegís (o, si después prendés «Leer todos los chats individuales», los de cualquiera que te escriba). De los demás se ve el nombre y cuándo escribieron, nunca el texto.'],
    ['La sesión vale como tu cuenta.', 'Se guarda en tu compu, cifrada con el llavero del sistema cuando se puede. «Desvincular» la borra junto con todos los mensajes.'],
    ['En un grupo, lee a todos.', 'Si elegís un grupo, cualquiera que escriba ahí le está escribiendo a tus agentes. Los agentes lo toman como información, no como órdenes. Después podés elegir que solo se lea a algunas personas del grupo.']
  ];

  function pintar(crear) {
    var vivo = true, reloj = null, datos = null;
    var hj = crear({ titulo: 'WhatsApp', ancho: 720, alCerrar: function () { vivo = false; clearTimeout(reloj); } });
    var cont = h('div'), err = h('div.error-txt');
    App.add(hj.cuerpo, cont, err);
    if (!hj.enVentana) App.add(hj.pie, h('button.btn.primario', { onclick: hj.cerrar }, 'Listo'));
    App.add(cont, App.cargando('Mirando la conexión con WhatsApp…'));

    function cargar() {
      return api().get('/api/whatsapp').then(function (r) {
        if (!vivo) return;
        datos = r; err.textContent = '';
        /* si estás escribiendo (el buscador, un campo), no se redibuja: se espera a la próxima vuelta */
        var foco = document.activeElement;
        var escribiendo = foco && cont.contains(foco) && /^(INPUT|TEXTAREA)$/.test(foco.tagName);
        if (!escribiendo || !foco.value) {
          redibujar();
          if (escribiendo && foco.classList.contains('wa-buscar')) { var nb = cont.querySelector('.wa-buscar'); if (nb) nb.focus({ preventScroll: true }); }
        }
        clearTimeout(reloj);
        // mientras vincula o sincroniza, se vuelve a preguntar seguido
        var tr = r.transcriptor && r.transcriptor.estado;
        var espera = r.estado === 'esperando_qr' || r.estado === 'conectando' ? 2500 : r.sincronizando || tr === 'cargando' || tr === 'trabajando' ? 4000 : 0;
        if (espera) reloj = setTimeout(function () { if (vivo) cargar(); }, espera);
      }).catch(function (e) { if (vivo) err.textContent = e.message; });
    }

    /* redibuja sin que la pantalla salte arriba (cambiar un ajuste de más abajo no tiene que perder el lugar) */
    function redibujar() {
      var el = cont, ys = [];
      while (el && el !== document.body) { if (el.scrollHeight > el.clientHeight) ys.push([el, el.scrollTop]); el = el.parentElement; }
      dibujar();
      ys.forEach(function (x) { x[0].scrollTop = x[1]; });
    }

    var vistaQR = null;   // {el, img}: mientras se espera el QR no se redibuja, solo se refresca la imagen
    function dibujar() {
      var e = datos.estado;
      if (e === 'esperando_qr' && vistaQR && cont.contains(vistaQR.el)) return refrescarQR();
      vistaQR = null;
      App.vaciar(cont);
      if (e === 'apagado') return dibujarInicio();
      if (e === 'revocado' || e === 'caido') return dibujarProblema(e);
      if (e === 'esperando_qr') return dibujarQR();
      if (e === 'conectando' && !datos.numero) return App.add(cont, App.cargando('Conectando con WhatsApp…'));
      dibujarConectado();
    }

    /* ---- antes de vincular: qué hace y qué riesgos tiene ---- */
    function dibujarInicio() {
      var ck = h('input', { type: 'checkbox' });
      var vincular = h('button.btn.primario', { disabled: true, onclick: function () {
        vincular.disabled = true;
        api().post('/api/whatsapp/vincular', { aceptoRiesgo: true }).then(cargar).catch(function (e2) { err.textContent = e2.message; vincular.disabled = false; });
      } }, 'Vincular WhatsApp');
      ck.addEventListener('change', function () { vincular.disabled = !ck.checked; });
      App.add(cont,
        h('div.ayuda', { style: { marginTop: 0, marginBottom: '12px' } },
          'Conectá tu WhatsApp para que los agentes que elijas puedan leer algunos chats: por ejemplo, que la secretaría vea que tu mamá tiene turno con el médico y te sugiera agendarlo. La oficina solo lee: no manda mensajes ni marca nada como leído.'),
        App.seccion('Antes de vincular', RIESGOS.map(function (r) {
          return h('div.ajuste', { style: { display: 'block' } }, h('div.ajuste-tit', r[0]), h('div.ajuste-ayuda', r[1]));
        })),
        h('label.ajuste-check', { style: { margin: '12px 0' } }, ck, h('span', 'Entiendo los riesgos')),
        App.acciones ? App.acciones([], vincular) : vincular);
    }

    function dibujarProblema(e) {
      var texto = e === 'revocado'
        ? 'WhatsApp cerró la sesión de la oficina (pasa si la cerrás desde el teléfono o si WhatsApp la da de baja). Para seguir leyendo, volvé a escanear el código.'
        : 'La conexión con WhatsApp se cayó varias veces seguidas y dejó de intentar. Podés probar de nuevo.';
      var otra = h('button.btn.primario', { onclick: function () {
        otra.disabled = true;
        api().post('/api/whatsapp/vincular', { aceptoRiesgo: true }).then(cargar).catch(function (e2) { err.textContent = e2.message; otra.disabled = false; });
      } }, e === 'revocado' ? 'Volver a vincular' : 'Reintentar');
      App.add(cont, h('div.ayuda', { style: { marginTop: 0 } }, texto), h('div', { style: { margin: '12px 0' } }, otra), pieDesvincular());
    }

    /* ---- QR ---- */
    function dibujarQR() {
      var img = h('img', { alt: '', width: 280, height: 280, style: { background: '#fff', padding: '8px', borderRadius: '8px', display: 'block', boxSizing: 'border-box' } });
      var el = h('div', { style: { display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' } }, img,
          h('ol', { style: { flex: 1, minWidth: '220px', lineHeight: '1.7' } },
            h('li', 'Abrí WhatsApp en el teléfono.'),
            h('li', 'Tocá Ajustes (o los tres puntos) › Dispositivos vinculados.'),
            h('li', 'Tocá «Vincular un dispositivo» y escaneá este código.'),
            h('li', { style: { color: 'var(--suave)' } }, 'El código cambia cada tanto: si no te lo toma, esperá a que se actualice.')));
      vistaQR = { el: el, img: img };
      App.add(cont, el, h('div', { style: { marginTop: '12px' } }, h('button.btn', { onclick: function () { desvincular(true); } }, 'Cancelar')));
      refrescarQR();
    }
    function refrescarQR() {
      var v = vistaQR;
      api().get('/api/whatsapp/qr').then(function (r) {
        if (vivo && v && v.img.getAttribute('src') !== r.qr) { v.img.src = r.qr; v.img.alt = 'Código QR para vincular WhatsApp'; }
      }).catch(function () {});
    }

    /* ---- conectado ----
       Arriba el número y el estado (Actualizar y Desvincular en «⋯»); qué se lee (los que elegís o todos los individuales);
       una sola lista con los chats que se leen y un buscador que también encuentra los demás chats y agrega números; «Elegir
       más chats» despliega el resto; las notas de voz en tres renglones. */
    var buscarTxt = '', verMas = false;
    function dibujarConectado() {
      var conectado = datos.estado === 'conectado';
      var sub = [conectado ? 'En línea' : 'Reconectando…'];
      if (datos.sincronizando) sub.push('trayendo tus chats' + (datos.sincronizando.progreso != null ? ' (' + datos.sincronizando.progreso + ' %)' : ''));
      else if (datos.telefonoVisto) sub.push('teléfono visto ' + App.hace(datos.telefonoVisto));
      if (datos.retencionDias) sub.push('guarda ' + datos.retencionDias + ' días');
      var mas = h('button.btn.icono', { title: 'Más opciones', onclick: function (ev) {
        App.menu(ev.currentTarget, [
          { texto: 'Actualizar', icono: 'recargar', accion: function () { cargar(); } },
          '-',
          { texto: 'Desvincular y borrar todo', icono: 'papelera', peligro: true, nota: 'cierra la sesión y borra los mensajes', accion: function () { desvincular(false); } }]);
      } }, App.icono('puntos'));
      var autos = datos.chats.filter(function (c) { return c.elegido && c.auto; });
      var elegidos = datos.chats.filter(function (c) { return c.elegido; });
      App.add(cont,
        h('div.sec-cabeza',
          h('span.wa-punto' + (conectado ? '.on' : '')),
          h('div.renglon-txt', h('div.sec-nombre', datos.numero || 'WhatsApp'), h('div.renglon-sub', sub.join(' · '))),
          mas),
        datos.cifrado ? null : h('div.ayuda', { style: { color: 'var(--peligro)', marginTop: 0 } }, 'Ojo: en esta compu la sesión se guarda sin cifrar.'),
        lineaTelefono(),
        App.seccion('Qué se lee', [leerTodos(autos), h('div.nota-chica', { style: { marginTop: '5px' } },
          datos.leerTodos ? 'Cada chat individual se empieza a leer solo con el primer mensaje. Los grupos se eligen a mano.' : 'Los grupos siempre se eligen a mano.')]),
        App.seccion('Chats', listaChats(), { cuenta: elegidos.length ? String(elegidos.length) : '' }),
        App.seccion('Notas de voz', notasDeVoz()));
    }

    /* WhatsApp desvincula un dispositivo si el teléfono no se conecta en 14 días. La captura no lo sabe directo: toma como indicio
       la última actividad propia que vio (un mensaje tuyo en cualquier chat). Por eso es una estimación, y solo se avisa cerca del límite. */
    function lineaTelefono() {
      if (!datos.telefonoVisto) return null;
      var dias = (Date.now() / 1000 - datos.telefonoVisto) / 86400;
      if (dias < 12) return null;
      return h('div.ayuda', { style: { margin: '0 0 8px', color: 'var(--peligro)' } },
        'El teléfono no se conecta desde ' + App.hace(datos.telefonoVisto) + ' (estimado). Si pasan 14 días, WhatsApp cierra la sesión de la oficina: abrí WhatsApp en el teléfono.');
    }

    /* «Leer todos los chats individuales»: para un negocio (WhatsApp Business o no) al que le escriben números que no tiene
       agendados. Cada chat individual se elige solo con el primer mensaje que llega; los grupos se siguen eligiendo a mano. */
    function leerTodos(autos) {
      var sel;
      var poner = function (si) {
        api().put('/api/whatsapp/ajustes', { leerTodos: si }).then(function (r) {
          datos = r; redibujar();
          App.guardado(si ? 'Desde ahora se lee cualquier chat individual que te escriba.' : 'Ya no se leen todos los chats: quedan los que elegiste.');
        }).catch(function (e) { err.textContent = e.message; sel.poner(si ? 'elijo' : 'todos'); });
      };
      sel = App.elegir({ forma: 'segmento', ancho: true, etiqueta: 'Qué chats se leen', valor: datos.leerTodos ? 'todos' : 'elijo',
        opciones: [{ valor: 'elijo', titulo: 'Solo los chats que elijo' },
          { valor: 'todos', titulo: 'Todos los individuales', sub: 'Para un negocio al que le escriben números que no tenés agendados. Todo lo que te escriban pasa por Claude.' }],
        alCambiar: function (v) {
          if (v === 'todos') return poner(true);
          if (!autos.length) return poner(false);
          App.confirmar('¿Dejar de leer todos los chats?', 'Se dejan de leer los ' + autos.length + ' chats que entraron solos y se borran sus mensajes. Los que elegiste o editaste se quedan.', 'Dejar de leer', true)
            .then(function (si) { if (si) poner(false); else sel.poner('todos'); });
        } });
      return sel;
    }

    function inicial(nombre) { var m = /[\p{L}\p{N}]/u.exec(String(nombre || '')); return m ? m[0].toUpperCase() : '#'; }
    function marcaChat(c) {
      var n = 0; String(c.jid || c.nombre || '').split('').forEach(function (ch) { n = (n * 31 + ch.charCodeAt(0)) % 997; });
      return h('span.wa-ini.t' + (n % 5), c.grupo ? App.icono('personas') : inicial(c.nombre));
    }
    function cuandoCorto(t) { return t ? App.hace(t).replace(/^hace /, '') : ''; }

    /* Un chat que se lee: nombre, nota o resumen, cuándo escribió y «⋯» (editar, dejar de leer). Tocarlo lo edita. */
    function filaElegido(c) {
      var cuantos = c.solo ? c.solo.length : 0;
      var sub = c.nota ? '«' + c.nota + '»'
        : c.grupo ? 'grupo' + (cuantos ? ' · se lee a ' + cuantos + (c.participantes ? ' de ' + c.participantes : '') + (cuantos === 1 ? ' persona' : ' personas') : c.participantes ? ' · ' + c.participantes + ' participantes' : '')
        : c.numero || '';
      if (c.auto) sub = 'entró solo' + (sub ? ' · ' + sub : '');
      return h('div.wa-chat.tocable', { onclick: function () { editar(c); } },
        marcaChat(c),
        h('div.wa-chat-txt', h('b', c.nombre), sub ? h('span', sub) : null),
        h('span.wa-chat-h', cuandoCorto(c.ultimo)),
        h('button.btn.chico.fantasma.icono', { title: 'Más opciones', onclick: function (ev) {
          ev.stopPropagation();
          App.menu(ev.currentTarget, [
            { texto: 'Editar', icono: 'lapiz', nota: c.grupo ? 'nombre, nota y a quiénes se lee' : 'nombre y nota', accion: function () { editar(c); } },
            '-',
            { texto: 'Dejar de leer', icono: 'papelera', peligro: true, accion: function () { quitar(c); } }]);
        } }, App.icono('puntos')));
    }

    /* Un chat que todavía no se lee: «Leer» lo elige (pide nombre y nota) */
    function filaChat(c) {
      var sub = c.grupo ? 'grupo' + (c.participantes ? ' · ' + c.participantes + ' participantes' : '') : c.sinNumero ? 'número desconocido todavía' : (c.numero || '');
      return h('div.wa-chat',
        marcaChat(c),
        h('div.wa-chat-txt', h('b', c.nombre), sub ? h('span', sub) : null),
        h('span.wa-chat-h', cuandoCorto(c.ultimo)),
        c.sinNumero ? null : h('button.btn.chico', { onclick: function () { elegir(c); } }, 'Leer'));
    }

    /* La lista: sin buscar, los chats que se leen y «Elegir más chats» (despliega los demás); buscando, de todos, y si
       parece un número que no está, «Agregar». */
    function listaChats() {
      var caja = h('div.wa-lista');
      var buscar = h('input.campo.wa-buscar', { type: 'search', placeholder: 'Buscar en tus chats o escribir un número…', value: buscarTxt });
      buscar.addEventListener('input', function () { buscarTxt = buscar.value; llenar(); });
      function coincide(c, q) { return [c.nombre, c.agenda, c.pista, c.numero].some(function (x) { return x && String(x).toLowerCase().indexOf(q) >= 0; }); }
      function poner(lista, tope, fila) {
        lista.slice(0, tope).forEach(function (c) { caja.appendChild(fila(c)); });
        if (lista.length > tope) caja.appendChild(h('div.ajuste-ayuda', { style: { padding: '6px 0' } }, 'Y ' + (lista.length - tope) + ' más: buscá para encontrarlos.'));
      }
      function llenar() {
        App.vaciar(caja);
        var q = buscarTxt.trim().toLowerCase();
        var elegidos = datos.chats.filter(function (c) { return c.elegido && !c.auto; }).concat(datos.chats.filter(function (c) { return c.elegido && c.auto; }));
        var resto = datos.chats.filter(function (c) { return !c.elegido; });
        if (!q) {
          if (elegidos.length) poner(elegidos, 40, filaElegido);
          else caja.appendChild(h('div.ajuste-ayuda', { style: { padding: '6px 0' } }, datos.leerTodos ? 'Todavía no entró ninguno: aparecen acá a medida que te escriben.' : 'Todavía no se lee ningún chat. Elegí cuáles abajo o buscá uno.'));
          var boton = h('button.btn.chico.fantasma.wa-mas', { onclick: function () { verMas = !verMas; llenar(); } },
            App.icono(verMas ? 'cerrar' : 'mas'), verMas ? 'Ocultar los demás chats' : 'Elegir más chats' + (resto.length ? ' (' + resto.length + ')' : ''));
          caja.appendChild(boton);
          if (verMas) {
            if (!resto.length) caja.appendChild(h('div.ajuste-ayuda', datos.sincronizando ? 'Trayendo tus chats…' : 'No hay más chats. Aparecen a medida que WhatsApp los manda.'));
            else { caja.appendChild(h('div.wa-sub-tit', 'Tus otros chats')); poner(resto, 60, filaChat); }
          }
          return;
        }
        var ve = elegidos.filter(function (c) { return coincide(c, q); }), vr = resto.filter(function (c) { return coincide(c, q); });
        ve.forEach(function (c) { caja.appendChild(filaElegido(c)); });
        if (vr.length) { if (ve.length) caja.appendChild(h('div.wa-sub-tit', 'Otros chats')); poner(vr, 40, filaChat); }
        var digitos = q.replace(/[^\d]/g, '');
        if (digitos.length >= 6 && !/[a-z]/i.test(q) && !datos.chats.some(function (c) { return String(c.numero || '').replace(/[^\d]/g, '') === digitos; })) {
          caja.appendChild(h('div.wa-chat.tocable', { onclick: function () { agregarNumero(buscarTxt.trim()); } },
            h('span.wa-ini', App.icono('mas')), h('div.wa-chat-txt', h('b', 'Agregar ' + buscarTxt.trim()), h('span', 'No está en tus chats: con el código de país')),
            h('button.btn.chico', { onclick: function (ev) { ev.stopPropagation(); agregarNumero(buscarTxt.trim()); } }, 'Agregar')));
        } else if (!ve.length && !vr.length) caja.appendChild(h('div.ajuste-ayuda', { style: { padding: '6px 0' } }, 'Nada con «' + buscarTxt.trim() + '». Para alguien que no aparece, escribí su número con el código de país.'));
      }
      llenar();
      return h('div', buscar, caja);
    }

    /* Agregar por número a alguien que todavía no aparece en la lista */
    function agregarNumero(numero) {
      var hj2 = App.hoja({ titulo: 'Leer un número', ancho: 420 });
      var num = h('input.campo', { value: numero, inputmode: 'tel', placeholder: '+54 9 11 5555-1234' });
      var nom = h('input.campo', { placeholder: 'Nombre (p. ej. Mamá)' });
      var err2 = h('div.error-txt');
      var ok = h('button.btn.primario', { onclick: function () {
        ok.disabled = true; err2.textContent = '';
        api().post('/api/whatsapp/chats', { numero: num.value, nombre: nom.value }).then(function (r) {
          App.guardado('Se lee ' + r.chat.nombre + ' desde ahora.');
          buscarTxt = ''; hj2.cerrar(); return cargar();
        }).catch(function (e) { err2.textContent = e.message; ok.disabled = false; });
      } }, 'Empezar a leer');
      App.add(hj2.cuerpo, h('label.etiqueta-campo', 'Número, con el código de país'), num,
        h('label.etiqueta-campo', { style: { marginTop: '12px' } }, 'Nombre'), nom,
        h('div.ajuste-ayuda', { style: { marginTop: '4px' } }, 'Es el que ven los agentes.'), err2);
      App.add(hj2.pie, h('button.btn', { onclick: hj2.cerrar }, 'Cancelar'), ok);
      setTimeout(function () { nom.focus(); }, 0);
    }

    /* transcribir las notas de voz en esta compu (Whisper, sin mandar el audio a ningún lado) */
    function notasDeVoz() {
      var t = datos.transcriptor || { estado: 'apagado' };
      var guardar = function (cambio, aviso) {
        api().put('/api/whatsapp/ajustes', cambio).then(function (r) { datos = r; redibujar(); App.guardado(aviso); })
          .catch(function (e) { err.textContent = e.message; redibujar(); });
      };
      var estado = !datos.transcribir ? 'El audio no sale de tu compu; así los agentes entienden los audios'
        : t.estado === 'cargando' ? (t.progreso != null && t.progreso < 100 ? 'Bajando el modelo (' + t.progreso + ' %)…' : 'Preparando la transcripción…')
        : t.estado === 'trabajando' ? 'Transcribiendo…'
        : t.estado === 'listo' ? 'Lista para transcribir · el audio no sale de tu compu'
        : t.estado === 'sin_motor' ? 'No está disponible en esta instalación' + (t.error ? ' (' + t.error + ')' : '')
        : 'Se prende sola cuando llega una nota de voz';
      var filas = [App.renglon({ titulo: 'Transcribirlas en tu compu', sub: estado, subError: datos.transcribir && t.estado === 'sin_motor',
        control: App.interruptor(datos.transcribir, function (si) {
          guardar({ transcribir: si }, si ? 'Las notas de voz nuevas se van a transcribir.' : 'Ya no se transcriben las notas de voz.');
        }, 'Transcribir las notas de voz') })];
      if (!datos.transcribir) return filas;
      var modelos = datos.modelos || [], idiomas = datos.idiomas || [];
      if (modelos.length) {
        var DESC = { rapido: 'más liviano, se equivoca más', normal: 'lo habitual', mejor: 'entiende mejor, tarda más y usa más memoria' };
        filas.push(h('div.renglon.wa-modelo', h('div.renglon-txt', h('div.renglon-tit', 'Modelo')),
          App.elegir({ forma: 'deslizador', etiqueta: 'Modelo de transcripción', valor: datos.modelo,
            opciones: modelos.map(function (m) { return { valor: m.id, titulo: m.nombre, sub: (DESC[m.id] ? DESC[m.id] + '. ' : '') + 'Baja unos ' + m.mb + ' MB la primera vez.' }; }),
            alCambiar: function (v) { if (v !== datos.modelo) guardar({ modelo: v }, 'Modelo cambiado: se usa desde la próxima nota de voz.'); } })));
      }
      var hayAuto = idiomas.some(function (i) { return i.id === 'auto'; });
      if (hayAuto && idiomas.length === 2) {
        var fijo = idiomas.filter(function (i) { return i.id !== 'auto'; })[0];
        filas.push(App.renglon({ titulo: 'Detectar el idioma', sub: datos.idioma === 'auto' ? 'Adivina el de cada audio (se puede equivocar en los muy cortos)' : 'Apagado: todo en ' + fijo.nombre.toLowerCase(),
          control: App.interruptor(datos.idioma === 'auto', function (si) {
            guardar({ idioma: si ? 'auto' : fijo.id }, 'Idioma cambiado: se usa desde la próxima nota de voz.');
          }, 'Detectar el idioma de los audios') }));
      } else if (idiomas.length) {
        filas.push(App.renglon({ titulo: 'Idioma', control: App.elegir({ forma: 'segmento', etiqueta: 'Idioma de los audios', valor: datos.idioma,
          opciones: idiomas.map(function (i) { return { valor: i.id, titulo: i.nombre }; }),
          alCambiar: function (v) { if (v !== datos.idioma) guardar({ idioma: v }, 'Idioma cambiado: se usa desde la próxima nota de voz.'); } }) }));
      }
      return filas;
    }

    /* ---- elegir / editar / quitar ---- */
    /* En un grupo elegido: «Leer a todos» o solo a algunos integrantes (lista con buscador). `valor()` da null (todos) o la lista. */
    function selectorPersonas(c) {
      var lista = c.miembros || [];
      var marcados = {};
      lista.forEach(function (m) { if (c.solo && m.seleccionado) marcados[m.jid] = true; });
      var todos = !c.solo;
      var radioTodos = h('input', { type: 'radio', name: 'wa-leer', checked: todos });
      var radioAlgunos = h('input', { type: 'radio', name: 'wa-leer', checked: !todos });
      var buscar = h('input.campo', { placeholder: 'Buscar por nombre o número', style: { width: '100%', margin: '6px 0' } });
      var caja = h('div', { style: { maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--borde, rgba(0,0,0,.12))', borderRadius: '8px', padding: '2px 8px' } });
      var cuenta = h('div.ajuste-ayuda');
      var zona = h('div', { style: { marginTop: '4px' } }, buscar, caja, cuenta);
      function cantidad() { return Object.keys(marcados).filter(function (k) { return marcados[k]; }).length; }
      function llenar() {
        App.vaciar(caja);
        var q = buscar.value.trim().toLowerCase();
        var vistos = lista.filter(function (m) { return !q || [m.nombre, m.numero].some(function (x) { return x && String(x).toLowerCase().indexOf(q) >= 0; }); });
        if (!lista.length) caja.appendChild(h('div.ajuste-ayuda', { style: { padding: '8px 0' } }, 'Todavía no llegó la lista de integrantes de este grupo. Se completa cuando WhatsApp la manda.'));
        vistos.forEach(function (m) {
          var ck = h('input', { type: 'checkbox', checked: !!marcados[m.jid] });
          ck.addEventListener('change', function () { marcados[m.jid] = ck.checked; resumen(); });
          caja.appendChild(h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', cursor: 'pointer' } }, ck,
            h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.nombre),
            m.numero && m.numero !== m.nombre ? h('span.ajuste-ayuda', m.numero) : null));
        });
        if (lista.length && !vistos.length) caja.appendChild(h('div.ajuste-ayuda', { style: { padding: '8px 0' } }, 'Nadie con «' + buscar.value + '».'));
      }
      function resumen() {
        var n = cantidad();
        cuenta.textContent = n ? 'Se leen los mensajes de ' + n + (n === 1 ? ' persona' : ' personas') + ' y los tuyos. Los ya guardados de los demás se borran al guardar.' : 'Elegí al menos una persona.';
      }
      function ver() { zona.style.display = radioAlgunos.checked ? '' : 'none'; }
      radioTodos.addEventListener('change', ver); radioAlgunos.addEventListener('change', ver);
      buscar.addEventListener('input', llenar);
      llenar(); resumen(); ver();
      var el = h('div', { style: { marginTop: '12px' } },
        h('label.etiqueta-campo', 'A quiénes se lee'),
        h('label.ajuste-check', { style: { display: 'flex', marginBottom: '4px' } }, radioTodos, h('span', 'Leer a todos')),
        h('label.ajuste-check', { style: { display: 'flex' } }, radioAlgunos, h('span', 'Solo a algunos integrantes')),
        zona);
      return {
        el: el,
        valor: function () {
          if (radioTodos.checked) return null;
          var l = Object.keys(marcados).filter(function (k) { return marcados[k]; });
          if (!l.length) throw new Error('Elegí al menos un integrante, o leé a todos.');
          return l;
        }
      };
    }

    function hojaChat(titulo, c, boton, alGuardar) {
      var hj2 = App.hoja({ titulo: titulo, ancho: 440 });
      var personas = c.grupo && c.elegido ? selectorPersonas(c) : null;
      var nom = h('input.campo', { value: c.nombreElegido || c.agenda || '', placeholder: c.pista || 'Mamá' });
      var nota = h('textarea.campo', { rows: 3, placeholder: 'Opcional. Por ejemplo: es mi mamá, tiene turnos médicos seguido y me avisa por acá.' });
      nota.value = c.nota || '';
      var err2 = h('div.error-txt');
      var ok = h('button.btn.primario', { onclick: function () {
        ok.disabled = true; err2.textContent = '';
        var solo;
        try { solo = personas ? personas.valor() : undefined; } catch (e0) { err2.textContent = e0.message; ok.disabled = false; return; }
        alGuardar(nom.value, nota.value, solo).then(function () { hj2.cerrar(); cargar(); }).catch(function (e) { err2.textContent = e.message; ok.disabled = false; });
      } }, boton);
      App.add(hj2.cuerpo,
        h('label.etiqueta-campo', 'Nombre'), nom,
        h('div.ajuste-ayuda', { style: { margin: '4px 0 12px' } }, 'Es el que ven los agentes.'),
        h('label.etiqueta-campo', 'Nota para los agentes'), nota,
        c.grupo && !c.elegido ? h('div.ajuste-ayuda', { style: { marginTop: '8px' } }, 'Es un grupo: se leen los mensajes de todos los que escriban ahí. Después de elegirlo, podés quedarte solo con algunas personas.') : null,
        personas ? personas.el : null,
        err2);
      App.add(hj2.pie, h('button.btn', { onclick: hj2.cerrar }, 'Cancelar'), ok);
    }
    function ruta(c) { return '/api/whatsapp/chats/' + encodeURIComponent(c.jid); }
    function elegir(c) {
      hojaChat('Leer «' + c.nombre + '»', c, 'Empezar a leer', function (n, nota) {
        return api().put(ruta(c), { elegido: true, nombre: n, nota: nota }).then(function (r) { App.guardado('Se lee ' + r.chat.nombre + ' desde ahora.'); });
      });
    }
    function editar(c) {
      hojaChat('Editar «' + c.nombre + '»', c, 'Guardar', function (n, nota, solo) {
        var cuerpo = { nombre: n, nota: nota };
        if (solo !== undefined) cuerpo.solo = solo;
        return api().put(ruta(c), cuerpo);
      });
    }
    function quitar(c) {
      var extra = datos.leerTodos && !c.grupo ? ' Aunque esté prendido «Leer todos», no se vuelve a leer solo.' : '';
      App.confirmar('¿Dejar de leer «' + c.nombre + '»?', 'Se borran los mensajes guardados de este chat. Si lo volvés a elegir, se lee desde ese momento.' + extra, 'Dejar de leer', true).then(function (si) {
        if (!si) return;
        api().put(ruta(c), { elegido: false }).then(function () { App.guardado('Ya no se lee ' + c.nombre + '.'); return cargar(); }).catch(App.fallo);
      });
    }

    /* ---- desvincular ---- */
    function pieDesvincular() {
      return h('div', { style: { marginTop: '20px', paddingTop: '12px', borderTop: '1px solid var(--borde, rgba(0,0,0,.08))' } },
        h('button.btn.peligro', { onclick: function () { desvincular(false); } }, 'Desvincular y borrar todo'),
        h('div.ajuste-ayuda', { style: { marginTop: '6px' } }, 'Cierra la sesión (el dispositivo desaparece de tu teléfono) y borra la sesión, la lista de chats y todos los mensajes guardados.'));
    }
    function desvincular(sinPreguntar) {
      var hacer = function () {
        App.vaciar(cont).appendChild(App.cargando('Desvinculando…'));
        api().post('/api/whatsapp/desvincular').then(function () { App.guardado('WhatsApp desvinculado. Se borró todo.'); return cargar(); })
          .catch(function (e) { err.textContent = e.message; cargar(); });
      };
      if (sinPreguntar) return hacer();
      App.confirmar('¿Desvincular WhatsApp?', 'Se cierra la sesión y se borran la lista de chats y todos los mensajes guardados. Los agentes dejan de poder leerlos.', 'Desvincular', true).then(function (si) { if (si) hacer(); });
    }

    cargar();
  }

  App.WhatsApp = { pintar: pintar };
})();
