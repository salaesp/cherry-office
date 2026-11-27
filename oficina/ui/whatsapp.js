/* Ajustes › WhatsApp (docs/plan-secretaria.md, fase S1): vincular por QR, elegir qué chats se leen y desvincular.
   La conexión es de toda la app (hay un solo WhatsApp). Qué agente lee estos chats se decide en su ficha
   («Puede leer WhatsApp»). API: GET /api/whatsapp, GET /api/whatsapp/qr, POST /api/whatsapp/vincular,
   POST /api/whatsapp/desvincular, PUT /api/whatsapp/ajustes (transcripción: modelo e idioma), POST /api/whatsapp/chats,
   PUT /api/whatsapp/chats/:jid (en un grupo, `solo`: a quiénes se lee). «Leer todos los chats individuales» (`leerTodos` en
   PUT /api/whatsapp/ajustes): para un negocio que no tiene agendados a quienes le escriben; cada chat individual nuevo se
   elige solo (`auto`) desde su primer mensaje. */
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
    var vivo = true, reloj = null, datos = null, filtro = '';
    var actualizar = h('button.btn.chico', { onclick: function () { cargar(); } }, App.icono('recargar'), 'Actualizar');
    var hj = crear({ titulo: 'WhatsApp', ancho: 720, acciones: [actualizar], alCerrar: function () { vivo = false; clearTimeout(reloj); } });
    var cont = h('div'), err = h('div.error-txt');
    App.add(hj.cuerpo, cont, err);
    if (!hj.enVentana) App.add(hj.pie, h('button.btn.primario', { onclick: hj.cerrar }, 'Listo'));
    App.add(cont, App.cargando('Mirando la conexión con WhatsApp…'));

    function cargar() {
      return api().get('/api/whatsapp').then(function (r) {
        if (!vivo) return;
        datos = r; err.textContent = '';
        dibujar();
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
          'Conectá tu WhatsApp para que los agentes que elijas puedan leer algunos chats: por ejemplo, que el secretario vea que tu mamá tiene turno con el médico y te sugiera agendarlo. La oficina solo lee: no manda mensajes ni marca nada como leído.'),
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

    /* ---- conectado ---- */
    function dibujarConectado() {
      var elegidos = datos.chats.filter(function (c) { return c.elegido && !c.auto; });
      var autos = datos.chats.filter(function (c) { return c.elegido && c.auto; });
      var estado = datos.estado === 'conectado' ? 'Conectado' : 'Reconectando…';
      App.add(cont,
        h('div.ajuste', h('div', h('div.ajuste-tit', estado + (datos.numero ? ' con ' + datos.numero : '')),
          h('div.ajuste-ayuda', datos.sincronizando
            ? 'Trayendo la lista de chats' + (datos.sincronizando.progreso != null ? ' (' + datos.sincronizando.progreso + ' %)' : '') + '… Los mensajes viejos no se guardan.'
            : 'Se guarda lo que llega a los chats elegidos, desde que los elegís, y se borra a los ' + datos.retencionDias + ' días.')),
          h('div.ajuste-control', h('span.insignia' + (datos.estado === 'conectado' ? '.ok' : ''), datos.estado === 'conectado' ? 'En línea' : 'Esperando'))),
        datos.cifrado ? null : h('div.ayuda', { style: { color: 'var(--peligro)' } }, 'Ojo: en esta compu la sesión se guarda sin cifrar.'),
        lineaTelefono(),
        App.seccion('Chats que se leen', elegidos.length ? elegidos.map(filaElegido) : h('div.ajuste-ayuda', datos.leerTodos ? 'No elegiste ninguno a mano: se leen los que entran solos (abajo).' : 'Todavía no elegiste ninguno. Elegilos de la lista de abajo o agregá uno por número.'),
          { cuenta: elegidos.length ? String(elegidos.length) : '', ayuda: 'Para que un agente los lea, activá «Puede leer WhatsApp» en su ficha.' }),
        App.seccion('Todos los mensajes que llegan', leerTodos(autos), { cuenta: autos.length ? String(autos.length) : '' }),
        App.seccion('Notas de voz e imágenes', notasDeVoz()),
        App.seccion('Agregar por número', formNumero()),
        App.seccion('Elegir de tus chats', listaChats()),
        pieDesvincular());
    }

    /* WhatsApp desvincula un dispositivo si el teléfono no se conecta en 14 días. La captura no lo sabe directo: toma como indicio
       la última actividad propia que vio (un mensaje tuyo en cualquier chat). Por eso es una estimación. */
    function lineaTelefono() {
      if (!datos.telefonoVisto) return null;
      var dias = (Date.now() / 1000 - datos.telefonoVisto) / 86400;
      var tarde = dias >= 12;
      return h('div.ayuda', { style: { margin: '4px 0 10px', color: tarde ? 'var(--peligro)' : '' } },
        'El teléfono se vio por última vez ' + App.hace(datos.telefonoVisto) + ' (es una estimación: se mira tu última actividad en WhatsApp).' +
        (tarde ? ' Si pasan 14 días sin que el teléfono se conecte, WhatsApp cierra la sesión de la oficina: abrí WhatsApp en el teléfono.' : ''));
    }

    function filaElegido(c) {
      var cuantos = c.solo ? c.solo.length : 0;
      var sub = [c.grupo ? 'Grupo' + (c.participantes ? ' · ' + c.participantes + ' participantes' : '') + (cuantos ? ' · se lee a ' + cuantos + (cuantos === 1 ? ' persona' : ' personas') : '') : (c.numero || ''), c.ultimo ? App.hace(c.ultimo) : null].filter(Boolean).join(' · ');
      return h('div.ajuste', { style: { display: 'block' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('div', { style: { flex: 1 } }, h('div.ajuste-tit', c.nombre), h('div.ajuste-ayuda', sub)),
          h('button.btn.chico', { onclick: function () { editar(c); } }, App.icono('lapiz'), 'Editar'),
          h('button.btn.chico.fantasma', { title: 'Dejar de leer', onclick: function () { quitar(c); } }, App.icono('papelera'))),
        c.nota ? h('div.ajuste-ayuda', { style: { marginTop: '4px', fontStyle: 'italic' } }, 'Nota: ' + c.nota) : null);
    }

    /* «Leer todos los chats individuales»: para un negocio (WhatsApp Business o no) al que le escriben números que no tiene
       agendados. Cada chat individual se elige solo con el primer mensaje que llega; los grupos se siguen eligiendo a mano. */
    var filtroAuto = '';
    function leerTodos(autos) {
      var ck = h('input', { type: 'checkbox', checked: !!datos.leerTodos });
      var poner = function (si) {
        api().put('/api/whatsapp/ajustes', { leerTodos: si }).then(function (r) {
          datos = r; redibujar();
          App.guardado(si ? 'Desde ahora se lee cualquier chat individual que te escriba.' : 'Ya no se leen todos los chats: quedan los que elegiste.');
        }).catch(function (e) { err.textContent = e.message; ck.checked = !si; });
      };
      ck.addEventListener('change', function () {
        if (ck.checked) return poner(true);
        if (!autos.length) return poner(false);
        App.confirmar('¿Dejar de leer todos los chats?', 'Se dejan de leer los ' + autos.length + ' chats que entraron solos y se borran sus mensajes. Los que elegiste o editaste se quedan.', 'Dejar de leer', true)
          .then(function (si) { if (si) poner(false); else ck.checked = true; });
      });
      var partes = [
        App.ajuste('Leer todos los chats individuales',
          'Para un negocio al que le escriben números que no tenés agendados (por ejemplo, clientes por WhatsApp Business). Cada chat individual se empieza a leer solo desde el primer mensaje que te mandan; no se leen los mensajes de antes. Los grupos se siguen eligiendo a mano.',
          h('label.ajuste-check', ck, h('span', 'Leer todos')))
      ];
      if (datos.leerTodos) {
        partes.push(h('div.ajuste-ayuda', { style: { margin: '-4px 0 8px' } },
          'Ojo: así todo lo que te escriba cualquiera pasa por Claude. Si sacás un chat de esta lista, no se vuelve a leer solo. Para darle nombre o una nota, tocá «Editar»: pasa a la lista de arriba.'));
        if (!autos.length) partes.push(h('div.ajuste-ayuda', 'Todavía no entró ninguno: aparecen acá a medida que te escriben.'));
        else {
          var caja = h('div');
          var buscar = autos.length > 8 ? h('input.campo', { placeholder: 'Buscar por nombre o número', value: filtroAuto, style: { width: '100%', marginBottom: '8px' } }) : null;
          var llenar = function () {
            App.vaciar(caja);
            var q = filtroAuto.trim().toLowerCase();
            var vistos = autos.filter(function (c) { return !q || [c.nombre, c.agenda, c.pista, c.numero].some(function (x) { return x && String(x).toLowerCase().indexOf(q) >= 0; }); });
            vistos.slice(0, 30).forEach(function (c) { caja.appendChild(filaElegido(c)); });
            if (vistos.length > 30) caja.appendChild(h('div.ajuste-ayuda', 'Y ' + (vistos.length - 30) + ' más: buscá para encontrarlos.'));
            if (q && !vistos.length) caja.appendChild(h('div.ajuste-ayuda', 'Nada con «' + filtroAuto + '».'));
          };
          if (buscar) buscar.addEventListener('input', function () { filtroAuto = buscar.value; llenar(); });
          llenar();
          partes.push(buscar, caja);
        }
      }
      return h('div', partes);
    }

    /* transcribir las notas de voz en esta compu (Whisper, sin mandar el audio a ningún lado) */
    function notasDeVoz() {
      var t = datos.transcriptor || { estado: 'apagado' };
      var ck = h('input', { type: 'checkbox', checked: datos.transcribir });
      ck.addEventListener('change', function () {
        api().put('/api/whatsapp/ajustes', { transcribir: ck.checked }).then(function (r) {
          datos = r; redibujar();
          App.guardado(ck.checked ? 'Las notas de voz nuevas se van a transcribir.' : 'Ya no se transcriben las notas de voz.');
        }).catch(function (e) { err.textContent = e.message; ck.checked = !ck.checked; });
      });
      var estado = !datos.transcribir ? null
        : t.estado === 'cargando' ? (t.progreso != null && t.progreso < 100 ? 'Bajando el modelo de transcripción (' + t.progreso + ' %)…' : 'Preparando la transcripción…')
        : t.estado === 'trabajando' ? 'Transcribiendo…'
        : t.estado === 'listo' ? 'Lista para transcribir.'
        : t.estado === 'sin_motor' ? 'La transcripción no está disponible en esta instalación' + (t.error ? ' (' + t.error + ')' : '') + '.'
        : 'Se prende sola cuando llega una nota de voz.';
      var guardar = function (cambio, aviso) {
        api().put('/api/whatsapp/ajustes', cambio).then(function (r) { datos = r; redibujar(); App.guardado(aviso); })
          .catch(function (e) { err.textContent = e.message; redibujar(); });
      };
      var modelos = datos.modelos || [], idiomas = datos.idiomas || [];
      var selModelo = modelos.length ? App.elegir({
        forma: 'lista', etiqueta: 'Modelo de transcripción', valor: datos.modelo,
        opciones: modelos.map(function (m) {
          return { valor: m.id, titulo: m.nombre, sub: (m.id === 'rapido' ? 'Más liviano, se equivoca más. ' : m.id === 'mejor' ? 'Entiende mejor, tarda más y usa más memoria. ' : 'Lo habitual. ') + 'Descarga de unos ' + m.mb + ' MB la primera vez.' };
        }),
        alCambiar: function (v) { if (v !== datos.modelo) guardar({ modelo: v }, 'Modelo cambiado: se usa desde la próxima nota de voz.'); }
      }) : null;
      var selIdioma = idiomas.length ? App.elegir({
        forma: 'chips', etiqueta: 'Idioma de los audios', valor: datos.idioma,
        opciones: idiomas.map(function (i) { return { valor: i.id, titulo: i.nombre }; }),
        alCambiar: function (v) { if (v !== datos.idioma) guardar({ idioma: v }, 'Idioma cambiado: se usa desde la próxima nota de voz.'); }
      }) : null;
      return h('div',
        App.ajuste('Transcribir las notas de voz', 'En tu compu, sin mandar el audio a ningún lado. La primera vez baja el modelo; mientras transcribe usa bastante memoria y después se apaga sola. Así los agentes entienden lo que dicen los audios.',
          h('label.ajuste-check', ck, h('span', 'Transcribir'))),
        estado ? h('div.ajuste-ayuda', { style: { margin: '-4px 0 8px', color: t.estado === 'sin_motor' ? 'var(--peligro)' : '' } }, estado) : null,
        selModelo ? h('div', { style: { margin: '8px 0' } }, h('label.etiqueta-campo', 'Modelo'), selModelo) : null,
        selIdioma ? h('div', { style: { margin: '8px 0' } }, h('label.etiqueta-campo', 'Idioma de los audios'), selIdioma,
          h('div.ajuste-ayuda', { style: { marginTop: '4px' } }, 'Si te hablan en otros idiomas, «Detectar automáticamente» adivina el de cada audio (se puede equivocar en los muy cortos).')) : null,
        h('div.ajuste-ayuda', 'Las imágenes de los chats elegidos se guardan cifradas y los agentes las pueden mirar (por ejemplo, la foto de una orden médica).'));
    }

    function formNumero() {
      var num = h('input.campo', { placeholder: '+54 9 11 5555-1234', inputmode: 'tel', style: { flex: '1 1 160px' } });
      var nom = h('input.campo', { placeholder: 'Nombre (p. ej. Mamá)', style: { flex: '1 1 140px' } });
      var btn = h('button.btn', { onclick: function () {
        err.textContent = ''; btn.disabled = true;
        api().post('/api/whatsapp/chats', { numero: num.value, nombre: nom.value }).then(function (r) {
          App.guardado('Se lee ' + r.chat.nombre + ' desde ahora.');
          num.value = ''; nom.value = '';
          return cargar();
        }).catch(function (e) { err.textContent = e.message; }).then(function () { btn.disabled = false; });
      } }, App.icono('mas'), 'Agregar');
      return h('div', h('div.ajuste-ayuda', { style: { marginBottom: '6px' } }, 'Para alguien que todavía no aparece en la lista. Con el código de país.'),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, num, nom, btn));
    }

    function listaChats() {
      var caja = h('div');
      var buscar = h('input.campo', { placeholder: 'Buscar por nombre o número', value: filtro, style: { width: '100%', marginBottom: '8px' } });
      buscar.addEventListener('input', function () { filtro = buscar.value; llenar(); });
      function llenar() {
        App.vaciar(caja);
        var q = filtro.trim().toLowerCase();
        var todos = datos.chats.filter(function (c) { return !c.elegido; });
        var vistos = todos.filter(function (c) {
          if (!q) return true;
          return [c.nombre, c.agenda, c.pista, c.numero].some(function (x) { return x && String(x).toLowerCase().indexOf(q) >= 0; });
        });
        if (!todos.length) { caja.appendChild(h('div.ajuste-ayuda', datos.sincronizando ? 'Trayendo tus chats…' : 'Todavía no llegó ningún chat. Aparecen a medida que WhatsApp los manda.')); return; }
        vistos.slice(0, 60).forEach(function (c) { caja.appendChild(filaChat(c)); });
        if (vistos.length > 60) caja.appendChild(h('div.ajuste-ayuda', 'Y ' + (vistos.length - 60) + ' más: buscá para encontrarlos.'));
        if (!vistos.length) caja.appendChild(h('div.ajuste-ayuda', 'Nada con «' + filtro + '».'));
      }
      llenar();
      return h('div', buscar, caja);
    }

    function filaChat(c) {
      var sub = c.grupo ? 'Grupo' + (c.participantes ? ' · ' + c.participantes + ' participantes' : '')
        : c.sinNumero ? 'Número desconocido todavía' : (c.numero || '');
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--borde, rgba(0,0,0,.08))' } },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.nombre),
          h('div.ajuste-ayuda', sub + (c.ultimo ? ' · ' + App.hace(c.ultimo) : ''))),
        c.sinNumero ? null : h('button.btn.chico', { onclick: function () { elegir(c); } }, 'Elegir'));
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
