/* Revisar una entrega (docs/plan-vista-previa.md): ver cada archivo tal cual queda, marcar encima lo que hay que cambiar
   y mandárselo al agente como «Pedir cambios», o retocar un texto chico a mano.
   - La página del agente corre en un iframe sandbox con la CSP del chat (App.ChatRico.documento). Para marcar y retocar se
     le inyecta un script chico que habla con esta ventana por postMessage; lo que manda se toma como dato, nunca como orden,
     y solo se acepta en el modo que corresponde.
   - Las notas en curso se guardan en localStorage por entrega: cerrar la hoja no las pierde.
   App.Revisar.abrir(entrega, {archivo?, puedeCambiar, puedeRetocar, listo?: () => fn|null, alCambios, alCerrar}) */
App.Revisar = (function () {
  var h = function () { return App.h.apply(null, arguments); };
  var api = function () { return App.api; };

  var EXT = { html: 'html', htm: 'html', md: 'markdown', markdown: 'markdown', mdown: 'markdown', mkd: 'markdown', csv: 'csv', tsv: 'csv',
    png: 'imagen', jpg: 'imagen', jpeg: 'imagen', gif: 'imagen', webp: 'imagen', svg: 'imagen', pdf: 'pdf',
    txt: 'texto', json: 'texto', log: 'texto', xml: 'texto', yaml: 'texto', yml: 'texto', mmd: 'texto', mermaid: 'texto' };
  function tipo(rel) { var m = /\.([^./]+)$/.exec(rel || ''); return (m && EXT[m[1].toLowerCase()]) || 'otro'; }
  function conVista(e) { return (e.archivos || []).filter(function (r) { return tipo(r) !== 'otro'; }); }
  function nombreArchivo(rel) { return String(rel || '').split('/').pop(); }
  function corto(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ---------------- notas guardadas por entrega ---------------- */
  function clave(e) { return 'oficina.revisar.' + ((App.E && App.E.carpeta) || '') + '.' + e.id; }
  function leerNotas(e) {
    try { var v = JSON.parse(localStorage.getItem(clave(e)) || '[]'); return Array.isArray(v) ? v : []; } catch (x) { return []; }
  }
  function guardarNotas(e, notas) {
    try { if (notas.length) localStorage.setItem(clave(e), JSON.stringify(notas)); else localStorage.removeItem(clave(e)); } catch (x) { /* sin almacenamiento: quedan en memoria */ }
  }
  function cuantasNotas(e) { return leerNotas(e).length; }

  /* ---------------- el script que va dentro de la página ---------------- */
  var PUENTE = '<script>(function(){' +
    'var modo="ver",marcado=null,editando=null,pines=[];' +
    'var css=document.createElement("style");css.textContent=".__ov-m{outline:2px solid #e8590c!important;outline-offset:2px;cursor:crosshair!important}' +
      '.__ov-e{outline:2px dashed #1c7ed6!important;outline-offset:2px;cursor:text!important}.__ov-editando{outline:2px solid #1c7ed6!important;outline-offset:2px;background:rgba(28,126,214,.08)!important}' +
      '.__ov-pin{position:absolute;z-index:2147483647;min-width:22px;height:22px;padding:0 5px;box-sizing:border-box;border-radius:11px;background:#e8590c;color:#fff;font:600 12px/22px system-ui,sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:none}";' +
    '(document.head||document.documentElement).appendChild(css);' +
    'function enviar(m){m.oficinaVista=1;parent.postMessage(m,"*");}' +
    'function hoja(el){if(!el||el.nodeType!==1||!el.childNodes.length||/^(SCRIPT|STYLE|HTML|BODY|HEAD)$/.test(el.tagName))return false;' +
      'for(var i=0;i<el.childNodes.length;i++){if(el.childNodes[i].nodeType!==3)return false;}return el.textContent.trim()!=="";}' +
    'function sel(el){var p=[];while(el&&el.nodeType===1&&el.tagName!=="BODY"&&el.tagName!=="HTML"&&p.length<4){var s=el.tagName.toLowerCase();' +
      'if(el.id){p.unshift(s+"#"+el.id);break;}var c=[].slice.call(el.classList).filter(function(x){return x.indexOf("__ov")!==0;}).slice(0,2);if(c.length)s+="."+c.join(".");' +
      'var par=el.parentElement;if(par){var h=[].filter.call(par.children,function(x){return x.tagName===el.tagName;});if(h.length>1)s+=":nth-of-type("+(h.indexOf(el)+1)+")";}' +
      'p.unshift(s);el=par;}return p.join(" > ");}' +
    'function limpiar(){if(marcado){marcado.classList.remove("__ov-m","__ov-e");marcado=null;}}' +
    'document.addEventListener("mouseover",function(e){if(modo==="ver"||editando)return;limpiar();var t=e.target;' +
      'if(modo==="editar"&&!hoja(t))return;if(t===document.body||t===document.documentElement)return;marcado=t;t.classList.add(modo==="marcar"?"__ov-m":"__ov-e");},true);' +
    'document.addEventListener("mouseout",function(){if(!editando)limpiar();},true);' +
    'document.addEventListener("click",function(e){if(modo==="ver")return;if(editando&&editando.contains(e.target))return;e.preventDefault();e.stopPropagation();var t=e.target;' +
      'if(modo==="marcar"){if(t===document.body||t===document.documentElement)return;var txt=(t.innerText||t.textContent||"").replace(/\\s+/g," ").trim();' +
        'enviar({tipo:"nota",selector:sel(t),cita:txt.slice(0,200)||t.getAttribute("alt")||t.tagName.toLowerCase()});}' +
      'else if(modo==="editar"&&hoja(t))empezar(t);},true);' +
    'document.addEventListener("submit",function(e){if(modo!=="ver")e.preventDefault();},true);' +
    'function empezar(el){limpiar();editando=el;el.__antes=el.textContent;try{el.contentEditable="plaintext-only";}catch(x){el.contentEditable="true";}' +
      'el.classList.add("__ov-editando");el.focus();var r=document.createRange();r.selectNodeContents(el);var s=getSelection();s.removeAllRanges();s.addRange(r);' +
      'el.addEventListener("keydown",tecla);el.addEventListener("blur",confirmar);}' +
    'function tecla(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();confirmar();}else if(e.key==="Escape"){e.preventDefault();cancelar();}}' +
    'function soltar(el){el.removeEventListener("keydown",tecla);el.removeEventListener("blur",confirmar);el.removeAttribute("contenteditable");el.classList.remove("__ov-editando");editando=null;}' +
    'function cancelar(){var el=editando;if(!el)return;soltar(el);el.textContent=el.__antes;}' +
    'function confirmar(){var el=editando;if(!el)return;soltar(el);var antes=el.__antes,nuevo=el.textContent;' +
      'if(nuevo.trim()===antes.trim()){el.textContent=antes;return;}var ini=antes.match(/^\\s*/)[0],fin=antes.match(/\\s*$/)[0];' +
      'enviar({tipo:"retoque",antes:antes,despues:ini+nuevo.trim()+fin,selector:sel(el)});}' +
    'function pintar(){[].slice.call(document.querySelectorAll(".__ov-pin")).forEach(function(x){x.remove();});' +
      'pines.forEach(function(p){var el=null;try{el=document.querySelector(p.selector);}catch(x){}if(!el)return;var r=el.getBoundingClientRect();' +
      'var d=document.createElement("div");d.className="__ov-pin";d.textContent=p.n;d.style.left=Math.max(0,r.left+scrollX-10)+"px";d.style.top=Math.max(0,r.top+scrollY-10)+"px";document.body.appendChild(d);});}' +
    'addEventListener("resize",pintar);' +
    'addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data||{};if(d.oficinaVista!==1)return;' +
      'if(d.modo){if(editando)cancelar();limpiar();modo=d.modo;}if(d.pines){pines=d.pines;pintar();}});' +
    'if(document.readyState==="complete")enviar({tipo:"lista"});else addEventListener("load",function(){enviar({tipo:"lista"});});' +
    '})();<\/script>';

  function documentoHTML(html) {
    var doc = App.ChatRico.documento('html', html);
    var i = doc.toLowerCase().lastIndexOf('</body>');
    return i === -1 ? doc + PUENTE : doc.slice(0, i) + PUENTE + doc.slice(i);
  }

  /* ---------------- la hoja ---------------- */
  function abrir(e, op) {
    op = op || {};
    var archivos = conVista(e);
    if (!archivos.length) { App.aviso('Esta entrega no tiene archivos para ver acá.', true); return null; }
    var estado = {
      archivo: archivos.indexOf(op.archivo) !== -1 ? op.archivo : archivos[0],
      modo: 'ver', ancho: window.matchMedia('(max-width: 720px)').matches ? 'telefono' : 'escritorio', vista: null, notas: leerNotas(e), borrador: null, retoques: (e.retoques || []).length
    };
    var puedeCambiar = !!op.puedeCambiar, puedeRetocar = !!op.puedeRetocar;
    var anchoHoja = Math.max(720, Math.min(1400, window.innerWidth - 48));
    var hj = App.hoja({ titulo: 'Revisar · ' + e.titulo, ancho: anchoHoja, alto: '92vh', alCerrar: alCerrar });
    hj.el.classList.add('hoja-revisar');

    var pestanas = h('div.rev-pestanas'), barra = h('div.rev-barra'), avisos = h('div.rev-avisos');
    var vista = h('div.rev-vista'), lateral = h('div.rev-lateral');
    App.add(hj.cuerpo, h('div.rev-cab', pestanas, barra), avisos, h('div.rev-cuerpo', vista, puedeCambiar ? lateral : null));

    var marco = null;
    function alMensaje(ev) {
      if (!marco || ev.source !== marco.contentWindow) return;
      var d = ev.data || {};
      if (d.oficinaVista !== 1) return;
      if (d.tipo === 'lista') { enviarAlMarco({ modo: estado.modo, pines: pinesDe(estado.archivo) }); return; }
      if (d.tipo === 'nota' && estado.modo === 'marcar' && puedeCambiar) {
        borrador({ archivo: estado.archivo, ancla: { selector: corto(d.selector, 120), cita: corto(d.cita, 200) } });
        return;
      }
      if (d.tipo === 'retoque' && estado.modo === 'editar' && puedeRetocar && typeof d.antes === 'string' && typeof d.despues === 'string') {
        retocar({ archivo: estado.archivo, antes: d.antes, despues: d.despues }, { selector: d.selector, antes: d.antes, despues: d.despues });
      }
    }
    window.addEventListener('message', alMensaje);
    function enviarAlMarco(m) { if (marco && marco.contentWindow) { m.oficinaVista = 1; marco.contentWindow.postMessage(m, '*'); } }
    function alCerrar() {
      window.removeEventListener('message', alMensaje);
      document.removeEventListener('keydown', teclas, true);
      if (op.alCerrar) op.alCerrar();
    }
    function teclas(ev) {
      if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
      if (ev.target && ev.target.isContentEditable) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if ((ev.key === 'm' || ev.key === 'M') && puedeCambiar) { ev.preventDefault(); ponerModo(estado.modo === 'marcar' ? 'ver' : 'marcar'); }
    }
    document.addEventListener('keydown', teclas, true);

    /* -------- pestañas y barra -------- */
    function pintarPestanas() {
      App.vaciar(pestanas);
      if (archivos.length < 2) { pestanas.appendChild(h('span.rev-archivo-unico', { title: estado.archivo }, nombreArchivo(estado.archivo))); return; }
      archivos.forEach(function (rel) {
        var n = estado.notas.filter(function (x) { return x.archivo === rel; }).length;
        pestanas.appendChild(h('button.rev-pestana' + (rel === estado.archivo ? '.sel' : ''), { type: 'button', title: rel, onclick: function () { irA(rel); } },
          nombreArchivo(rel), n ? h('span.rev-cuenta', String(n)) : null));
      });
    }
    function pintarBarra() {
      App.vaciar(barra);
      var t = tipo(estado.archivo), v = estado.vista;
      var modos = [{ valor: 'ver', texto: 'Ver' }];
      if (puedeCambiar) modos.push({ valor: 'marcar', texto: t === 'pdf' || t === 'csv' ? 'Nota' : 'Marcar (M)' });
      if (puedeRetocar && v && v.retocable) modos.push({ valor: 'editar', texto: 'Retocar' });
      if (modos.length > 1) {
        barra.appendChild(h('div.rev-segmento', { role: 'group', 'aria-label': 'Modo' }, modos.map(function (m) {
          return h('button' + (estado.modo === m.valor ? '.sel' : ''), { type: 'button', 'aria-pressed': String(estado.modo === m.valor), onclick: function () { ponerModo(m.valor); } }, m.texto);
        })));
      }
      if (t === 'html') {
        barra.appendChild(h('div.rev-segmento', { role: 'group', 'aria-label': 'Ancho' }, [['escritorio', 'Escritorio'], ['tableta', 'Tableta'], ['telefono', 'Teléfono']].map(function (a) {
          return h('button' + (estado.ancho === a[0] ? '.sel' : ''), { type: 'button', onclick: function () { estado.ancho = a[0]; pintarBarra(); if (marco) marco.className = 'rev-marco ancho-' + a[0]; } }, a[1]);
        })));
      }
      barra.appendChild(h('span.rev-ayuda', ayudaModo(t)));
    }
    function ayudaModo(t) {
      if (estado.modo === 'marcar') {
        if (t === 'html') return 'Hacé clic en lo que querés cambiar y escribí la nota.';
        if (t === 'imagen') return 'Hacé clic en el punto de la imagen.';
        if (t === 'markdown' || t === 'texto') return 'Seleccioná el texto que querés cambiar.';
        return '';
      }
      if (estado.modo === 'editar') {
        if (t === 'html') return 'Hacé clic en un texto, cambialo y apretá Enter (Esc cancela). Solo textos simples.';
        return 'Cambiá el texto y guardá.';
      }
      return '';
    }
    function ponerModo(m) {
      var t = tipo(estado.archivo);
      if (m === 'marcar' && (t === 'pdf' || t === 'csv')) { borrador({ archivo: estado.archivo }); return; }
      estado.modo = m;
      pintarBarra();
      if (t === 'html') enviarAlMarco({ modo: m });
      else pintarVista();
    }
    function irA(rel) {
      if (rel === estado.archivo) return;
      estado.archivo = rel; estado.modo = 'ver'; estado.vista = null;
      cargar();
    }

    /* -------- la vista -------- */
    function cargar() {
      pintarPestanas(); pintarBarra(); App.vaciar(avisos);
      App.vaciar(vista).appendChild(App.cargando('Abriendo ' + nombreArchivo(estado.archivo) + '…'));
      var rel = estado.archivo;
      api().get('/api/entregas/' + e.id + '/vista', { ruta: rel }).then(function (r) {
        if (rel !== estado.archivo) return;
        estado.vista = r.vista;
        pintarBarra(); pintarVista(); pintarPie();
      }).catch(function (x) {
        if (rel !== estado.archivo) return;
        estado.vista = null;
        App.vaciar(vista).appendChild(App.vacio('abrir', 'No se puede ver acá', x.message,
          App.nativo.hay && App.E && App.E.carpeta ? [h('button.btn', { onclick: function () { App.nativo.abrir(App.E.carpeta.replace(/\/$/, '') + '/' + rel); } }, App.icono('abrir'), 'Abrir con otra app')] : null));
        pintarPie();
      });
    }
    function pintarVista() {
      var v = estado.vista; if (!v) return;
      App.vaciar(avisos);
      (v.avisos || []).slice(0, 4).forEach(function (a) { avisos.appendChild(h('div.rev-aviso', a)); });
      if (v.truncado) avisos.appendChild(h('div.rev-aviso', 'El archivo es largo: se muestra solo el principio.'));
      App.vaciar(vista); marco = null;
      vista.className = 'rev-vista tipo-' + v.tipo + ' modo-' + estado.modo;
      if (v.tipo === 'html') {
        marco = h('iframe.rev-marco.ancho-' + estado.ancho, { title: 'Vista de ' + v.nombre });
        marco.setAttribute('sandbox', 'allow-scripts allow-modals');
        marco.setAttribute('referrerpolicy', 'no-referrer');
        marco.srcdoc = documentoHTML(v.html || '');
        vista.appendChild(h('div.rev-escenario', marco));
      } else if (estado.modo === 'editar' && v.retocable) {
        vista.appendChild(editorTexto(v));
      } else if (v.tipo === 'markdown') {
        var doc = App.htmlSeguro(h('div.md-doc.rev-doc'), App.markdown(v.texto || ''));
        doc.addEventListener('mouseup', function () { if (estado.modo === 'marcar') citaSeleccionada(doc); });
        vista.appendChild(doc);
      } else if (v.tipo === 'texto') {
        var pre = h('pre.rev-texto', v.texto || '');
        pre.addEventListener('mouseup', function () { if (estado.modo === 'marcar') citaSeleccionada(pre); });
        vista.appendChild(pre);
      } else if (v.tipo === 'csv') {
        var filas = v.filas || [];
        vista.appendChild(h('div.rev-tabla', h('table',
          filas.length ? h('thead', h('tr', filas[0].map(function (c) { return h('th', c); }))) : null,
          h('tbody', filas.slice(1).map(function (f) { return h('tr', f.map(function (c) { return h('td', c); })); })))));
      } else if (v.tipo === 'imagen') {
        var img = h('img.rev-imagen', { src: 'data:' + v.mime + ';base64,' + v.base64, alt: v.nombre });
        var caja = h('div.rev-imagen-caja', img);
        img.addEventListener('click', function (ev) {
          if (estado.modo !== 'marcar') return;
          var r = img.getBoundingClientRect();
          borrador({ archivo: estado.archivo, ancla: { x: Math.round((ev.clientX - r.left) / r.width * 100), y: Math.round((ev.clientY - r.top) / r.height * 100) } });
        });
        pinesDe(estado.archivo).forEach(function (p) {
          if (typeof p.x === 'number') caja.appendChild(h('span.rev-pin', { style: { left: p.x + '%', top: p.y + '%' } }, String(p.n)));
        });
        vista.appendChild(caja);
      } else if (v.tipo === 'pdf') {
        var bin = atob(v.base64 || ''), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        var url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
        vista.appendChild(h('iframe.rev-pdf', { src: url, title: 'PDF ' + v.nombre }));
        setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
      } else {
        vista.appendChild(App.vacio('abrir', 'Sin vista previa', 'Abrilo con su aplicación.'));
      }
    }
    function citaSeleccionada(raiz) {
      var s = window.getSelection(), t = s ? String(s).replace(/\s+/g, ' ').trim() : '';
      if (!t || !s.rangeCount || !raiz.contains(s.getRangeAt(0).commonAncestorContainer)) return;
      var seccion = '', nodo = s.getRangeAt(0).startContainer;
      var el = nodo.nodeType === 1 ? nodo : nodo.parentElement;
      while (el && el !== raiz && el.parentElement !== raiz) el = el.parentElement;
      for (var x = el; x; x = x.previousElementSibling) if (/^H[1-4]$/.test(x.tagName)) { seccion = x.textContent; break; }
      borrador({ archivo: estado.archivo, ancla: { cita: corto(t, 200), seccion: corto(seccion, 120) || undefined } });
    }
    function pinesDe(rel) {
      var out = [];
      estado.notas.forEach(function (n, i) { if (n.archivo === rel && n.ancla) out.push({ n: i + 1, selector: n.ancla.selector, x: n.ancla.x, y: n.ancla.y }); });
      return out.filter(function (p) { return p.selector || typeof p.x === 'number'; });
    }

    /* -------- retoques -------- */
    function editorTexto(v) {
      var area = h('textarea.rev-editor', { spellcheck: 'true' });
      area.value = v.texto || '';
      var guardar = h('button.btn.primario.chico', { onclick: function () {
        guardar.disabled = true;
        retocar({ archivo: estado.archivo, texto: area.value, mod: v.mod }).then(function (ok) { guardar.disabled = false; if (ok) ponerModo('ver'); });
      } }, 'Guardar');
      setTimeout(function () { area.focus(); }, 30);
      return h('div.rev-editor-caja', h('div.rev-editor-barra', h('span.ayuda', 'Para cambios grandes, pedíselo al agente.'),
        h('button.btn.chico', { onclick: function () { ponerModo('ver'); } }, 'Cancelar'), guardar), area);
    }
    function retocar(cuerpo, siFalla) {
      return api().post('/api/entregas/' + e.id + '/retoque', cuerpo).then(function (r) {
        estado.retoques = (r.entrega.retoques || []).length;
        if (cuerpo.archivo === estado.archivo) { estado.vista = r.vista; pintarVista(); }
        pintarPie();
        App.guardado('Retocado.', deshacer);
        return true;
      }).catch(function (x) {
        if (siFalla && puedeCambiar && x.status === 409) {
          App.aviso('No lo pude retocar a mano: te lo dejo como nota para el agente.', true);
          if (estado.vista && cuerpo.archivo === estado.archivo) pintarVista();   // vuelve el texto original en la página
          borrador({ archivo: cuerpo.archivo, ancla: { selector: corto(siFalla.selector, 120), cita: corto(siFalla.antes, 200) },
            texto: 'Cambiá «' + corto(siFalla.antes, 160) + '» por «' + corto(siFalla.despues, 160) + '».' });
        } else {
          App.fallo(x);
          if (estado.vista && cuerpo.archivo === estado.archivo) pintarVista();
        }
        return false;
      });
    }
    function deshacer() {
      api().post('/api/entregas/' + e.id + '/deshacer-retoque').then(function (r) {
        estado.retoques = (r.entrega.retoques || []).length;
        if (r.vista && r.vista.rel === estado.archivo) { estado.vista = r.vista; pintarVista(); }
        pintarPie();
        App.aviso('Retoque deshecho.');
      }).catch(App.fallo);
    }

    /* -------- notas -------- */
    function dondeTxt(n) {
      var a = n.ancla || {};
      if (a.cita) return '«' + corto(a.cita, 70) + '»';
      if (typeof a.x === 'number') return 'Punto de la imagen';
      return n.archivo ? 'Sobre el archivo' : 'En general';
    }
    function borrador(n) {
      estado.borrador = { archivo: n.archivo || '', ancla: n.ancla, texto: n.texto || '' };
      pintarLateral();
    }
    function pintarLateral() {
      if (!puedeCambiar) return;
      App.vaciar(lateral);
      lateral.appendChild(h('div.rev-lat-tit', 'Notas para ' + (op.nombreAgente || 'el agente')));
      if (estado.borrador) {
        var b = estado.borrador;
        var area = h('textarea.campo', { rows: 3, maxlength: 1000, placeholder: 'Qué querés que cambie acá.' });
        area.value = b.texto || '';
        var agregar = function () {
          var t = area.value.trim(); if (!t) { area.focus(); return; }
          var nota = { archivo: b.archivo, texto: t };
          if (b.ancla) nota.ancla = b.ancla;
          estado.notas.push(nota); estado.borrador = null;
          guardarNotas(e, estado.notas);
          refrescarNotas();
        };
        area.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); agregar(); }
          if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); estado.borrador = null; pintarLateral(); }
        });
        lateral.appendChild(h('div.rev-borrador',
          h('div.rev-donde', dondeTxt(b)), area,
          h('div.rev-borrador-acc', h('button.btn.chico', { onclick: function () { estado.borrador = null; pintarLateral(); } }, 'Descartar'),
            h('button.btn.chico.primario', { onclick: agregar }, 'Agregar nota'))));
        setTimeout(function () { area.focus(); }, 30);
      }
      if (!estado.notas.length && !estado.borrador) {
        lateral.appendChild(h('div.rev-lat-vacio', 'Tocá «Marcar» y señalá en la vista lo que querés cambiar. Las notas se le mandan juntas al agente.'));
      }
      var lista = h('ol.rev-notas');
      estado.notas.forEach(function (n, i) {
        lista.appendChild(h('li.rev-nota', { onclick: function () { if (n.archivo && n.archivo !== estado.archivo) irA(n.archivo); } },
          h('span.rev-num', String(i + 1)),
          h('div.rev-nota-txt',
            h('div.rev-donde', (archivos.length > 1 && n.archivo ? nombreArchivo(n.archivo) + ' · ' : '') + dondeTxt(n)),
            h('div', n.texto)),
          h('button.btn.fantasma.icono.chico', { title: 'Borrar la nota', onclick: function (ev) {
            ev.stopPropagation(); estado.notas.splice(i, 1); guardarNotas(e, estado.notas); refrescarNotas();
          } }, App.icono('cerrar'))));
      });
      lateral.appendChild(lista);
      if (!estado.borrador) lateral.appendChild(h('button.btn.chico.fantasma.rev-general', { onclick: function () { borrador({ archivo: '' }); } }, App.icono('mas'), 'Nota general'));
    }
    function refrescarNotas() {
      pintarLateral(); pintarPestanas(); pintarPie();
      var t = tipo(estado.archivo);
      if (t === 'html') enviarAlMarco({ pines: pinesDe(estado.archivo) });
      else if (t === 'imagen') pintarVista();
    }
    function mandar() {
      var h2 = App.hoja({ titulo: 'Pedir cambios a ' + (op.nombreAgente || 'el agente'), ancho: 520 });
      var txt = h('textarea.campo', { rows: 3, maxlength: 4000, placeholder: 'Algo más, en general (opcional).' });
      var err = h('div.error-txt');
      App.add(h2.cuerpo,
        estado.notas.length ? h('ol.rev-notas.resumen', estado.notas.map(function (n) { return h('li', h('b', dondeTxt(n) + ': '), n.texto); })) : null,
        h('div.fila-campo', txt, h('div.ayuda', 'Se lo pide en la misma conversación. La versión nueva aparece como otra entrega sin revisar.')), err);
      var ok = h('button.btn.primario', { onclick: function () {
        var v = txt.value.trim();
        if (!v && !estado.notas.length) { err.textContent = 'Escribí qué querés que cambie.'; txt.focus(); return; }
        ok.disabled = true; err.textContent = '';
        var cuerpo = { notas: estado.notas };
        if (v) cuerpo.texto = v;
        api().post('/api/entregas/' + e.id + '/cambios', cuerpo).then(function () {
          estado.notas = []; guardarNotas(e, []);
          h2.cerrar(); hj.cerrar();
          if (op.alCambios) op.alCambios();
        }).catch(function (x) { err.textContent = x.message; ok.disabled = false; });
      } }, 'Pedir cambios');
      App.add(h2.pie, h('button.btn', { onclick: h2.cerrar }, 'Volver'), ok);
      setTimeout(function () { txt.focus(); }, 30);
    }

    /* -------- pie -------- */
    function pintarPie() {
      var v = estado.vista, izq = [], der = [];
      if (App.nativo.hay && v && v.ruta) izq.push(h('button.btn', { onclick: function () { App.nativo.abrir(v.ruta); } }, App.icono('abrir'), 'Abrir con otra app'));
      if (estado.retoques && puedeRetocar) izq.push(h('button.btn.fantasma', { title: 'Vuelve el archivo a como estaba antes del último retoque', onclick: deshacer }, 'Deshacer retoque'));
      der.push(h('button.btn', { onclick: hj.cerrar }, 'Cerrar'));
      if (puedeCambiar) {
        var n = estado.notas.length;
        der.push(h('button.btn' + (n ? '.primario' : ''), { onclick: mandar }, n ? 'Pedir cambios (' + n + ')' : 'Pedir cambios'));
      }
      var listo = op.listo && op.listo();
      if (listo && !estado.notas.length) der.push(h('button.btn.primario', { onclick: function () { hj.cerrar(); listo(); } }, 'Listo'));
      App.add(App.vaciar(hj.pie), App.acciones(izq, der));
    }

    pintarLateral();
    cargar();
    return hj;
  }

  return { abrir: abrir, tipo: tipo, conVista: conVista, cuantasNotas: cuantasNotas };
})();
