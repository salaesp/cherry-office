/* Chat rico, como Claude Code: imágenes en línea, bloques de código con Copiar, artefactos (HTML, SVG, mermaid) en un
   visor aislado, los pasos del agente (herramientas y textos intermedios) plegados y tarjetas de los archivos que escribió.
   Se engancha en App.htmlSeguro (todo lo que pasa por App.markdown) y lo usan el chat y las reuniones. */
(function () {
  'use strict';
  var h = App.h;

  /* ---------------- rutas de la oficina ---------------- */
  function normal(p) { return String(p || '').replace(/\\/g, '/'); }
  function absoluta(ruta) {
    var p = normal(ruta).replace(/^file:\/\//i, '');
    try { p = decodeURI(p); } catch (e) {}
    return p;
  }
  function esAbsoluta(p) { return p.charAt(0) === '/' || /^[a-z]:\//i.test(p); }
  function bajo(base, p) {
    base = normal(base).replace(/\/+$/, '');
    if (!base) return null;
    var win = /^[a-z]:\//i.test(base);
    var a = win ? p.toLowerCase() : p, b = win ? base.toLowerCase() : base;
    return a.indexOf(b + '/') === 0 ? p.slice(base.length + 1) : null;
  }
  /* ruta para pedirle al backend: relativa a la oficina activa, absoluta si cae en una de sus carpetas de trabajo (nada
     oculto, como .git o .env), o null si cae afuera (o no se puede saber) */
  function relOficina(ruta) {
    var p = absoluta(ruta);
    if (!esAbsoluta(p)) {
      p = p.replace(/^(\.\/)+/, '');
      return p && p.split('/').indexOf('..') < 0 ? p : null;
    }
    var rel = bajo(App.E.carpeta, p);
    if (rel !== null) return rel;
    var cs = (App.E.oficina && App.E.oficina.carpetasTrabajo) || [];
    for (var i = 0; i < cs.length; i++) {
      var r = bajo(cs[i].ruta, p);
      if (r !== null) return r.split('/').some(function (x) { return x === '..' || x.charAt(0) === '.'; }) ? null : p;
    }
    return null;
  }
  /* botón para sumar como carpeta de trabajo la carpeta de un archivo que quedó afuera; `listo(rel)` al agregarla */
  function botonTrabajo(ruta, listo) {
    var p = absoluta(ruta);
    if (!esAbsoluta(p) || !App.agregarCarpetaTrabajo) return null;
    var dir = p.split('/').slice(0, -1).join('/') || '/';
    return h('button.md-trabajo', { type: 'button', title: 'Que los agentes trabajen en esa carpeta y la app pueda mostrar lo que hay ahí',
      onclick: function (e) {
        e.stopPropagation();
        App.agregarCarpetaTrabajo(dir).then(function (c) {
          if (!c) return;
          var rel = relOficina(p);
          if (rel !== null) listo(rel); else App.aviso('Esa carpeta no incluye este archivo: elegí una carpeta que lo contenga.', true);
        });
      } }, App.icono('carpeta'), 'Agregar carpeta de trabajo');
  }
  function ext(nombre) { var m = /\.([a-z0-9]+)$/i.exec(nombre || ''); return m ? m[1].toLowerCase() : ''; }
  var EXT_IMAGEN = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1 };
  var EXT_ARTEFACTO = { html: 'html', htm: 'html', svg: 'svg', mmd: 'mermaid', mermaid: 'mermaid' };

  /* ---------------- artefactos ---------------- */
  /* El código del agente corre en un iframe sandbox (sin allow-same-origin: origen opaco, no ve la app ni sus datos) y con
     una CSP que no deja hablar con la API local (connect-src solo https:, sin formularios ni iframes). Puede cargar
     librerías de CDNs por https. */
  var CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:; " +
    "img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src https:; " +
    "form-action 'none'; frame-src 'none'; base-uri 'none'";
  var META = '<meta http-equiv="Content-Security-Policy" content="' + CSP + '"><meta charset="utf-8">';
  var MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs';
  function escHTML(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function documento(tipo, codigo) {
    if (tipo === 'html') {
      // la CSP va primera en el <head>: una meta posterior del agente solo puede restringir más, nunca aflojar
      if (/<head[\s>]/i.test(codigo)) return codigo.replace(/<head(\s[^>]*)?>/i, function (m) { return m + META; });
      if (/<html[\s>]/i.test(codigo)) return codigo.replace(/<html(\s[^>]*)?>/i, function (m) { return m + '<head>' + META + '</head>'; });
      return '<!doctype html><html><head>' + META + '</head><body>' + codigo + '</body></html>';
    }
    var estilo = '<style>html,body{margin:0;height:100%;background:#fff}body{display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font:14px system-ui,sans-serif}svg{max-width:100%;height:auto}</style>';
    if (tipo === 'svg') return '<!doctype html><html><head>' + META + estilo + '</head><body>' + codigo + '</body></html>';
    // mermaid
    return '<!doctype html><html><head>' + META + estilo + '<style>body{display:block}pre.mermaid{width:100%;margin:0;text-align:center}pre.mermaid svg{max-width:100%!important;height:auto}</style></head><body><pre class="mermaid">' + escHTML(codigo) + '</pre>' +
      '<script type="module">import m from "' + MERMAID + '";m.initialize({startOnLoad:false,securityLevel:"strict"});' +
      'm.run().catch(function(e){document.body.textContent="No se pudo dibujar el diagrama: "+(e&&e.message||e)});</script>' +
      '<noscript>Hace falta internet para dibujar el diagrama.</noscript></body></html>';
  }
  function tituloDe(tipo, codigo) {
    var m = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(codigo) || /<h1[^>]*>([^<]{1,120})<\/h1>/i.exec(codigo);
    if (m) return m[1].trim();
    return tipo === 'html' ? 'Página' : tipo === 'svg' ? 'Gráfico' : 'Diagrama';
  }
  function iframe(tipo, codigo) {
    var f = h('iframe.artefacto-marco', { title: 'Vista del artefacto' });
    f.setAttribute('sandbox', 'allow-scripts allow-modals allow-downloads');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.srcdoc = documento(tipo, codigo);
    return f;
  }
  function copiar(texto) {
    App.copiarTexto(texto);
  }

  /* nombre para bajar un artefacto del chat que no es un archivo: «Página.html», «Gráfico.svg» */
  var MIME = { html: 'text/html', svg: 'image/svg+xml', mermaid: 'text/plain' };
  var EXT_TIPO = { html: '.html', svg: '.svg', mermaid: '.mmd' };
  function nombreDe(tipo, titulo) {
    var base = String(titulo || 'artefacto').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 80) || 'artefacto';
    return /\.[a-z0-9]{2,8}$/i.test(base) ? base : base + EXT_TIPO[tipo];
  }

  /* visor grande: vista / código, copiar y abrir el archivo con otra app si lo hay */
  /* `op.vista`: lo que se dibuja, si no es el código mismo (una página de la oficina empaquetada con su CSS e imágenes) */
  function verArtefacto(op) {
    var tipo = op.tipo, codigo = op.codigo || '', vista = op.vista || codigo;
    var hj = App.visor({ titulo: op.titulo || tituloDe(tipo, codigo), ancho: 1040, alto: '90vh' });
    hj.el.classList.add('hoja-artefacto');
    var verCodigo = false;
    function pintar() {
      App.vaciar(hj.cuerpo);
      hj.cuerpo.appendChild(verCodigo ? h('pre.artefacto-codigo', codigo) : iframe(tipo, vista));
      alternar.textContent = verCodigo ? 'Ver vista' : 'Ver código';
    }
    var alternar = h('button.btn.izq', { onclick: function () { verCodigo = !verCodigo; pintar(); } });
    App.add(hj.pie, alternar,
      tipo === 'mermaid' ? h('span.ayuda', { style: { flex: 1 } }, 'El diagrama se dibuja con mermaid (necesita internet).') : null,
      h('button.btn', { onclick: function () { pintar(); } }, App.icono('recargar'), 'Recargar'),
      h('button.btn', { onclick: function () { copiar(codigo); } }, 'Copiar'),
      App.botonDescargar({ nombre: op.nombre || nombreDe(tipo, op.titulo || tituloDe(tipo, codigo)), rel: op.rel, texto: codigo, mime: MIME[tipo] }),
      App.nativo.hay && op.ruta ? h('button.btn', { onclick: function () { App.nativo.abrir(op.ruta); } }, App.icono('abrir'), 'Abrir con otra app') : null,
      h('button.btn.primario', { onclick: hj.cerrar }, 'Cerrar'));
    pintar();
    return hj;
  }

  /* imagen en grande */
  function verImagen(src, titulo, rel) {
    var hj = App.visor({ titulo: titulo || 'Imagen', ancho: 1000, alto: '88vh' });
    hj.el.classList.add('hoja-imagen');
    hj.cuerpo.appendChild(h('img.imagen-grande', { src: src, alt: titulo || '' }));
    App.add(hj.pie, App.botonDescargar({ nombre: titulo || 'imagen', rel: rel, url: src }), h('button.btn.primario', { onclick: hj.cerrar }, 'Cerrar'));
  }

  /* ---------------- archivos de la oficina ---------------- */
  var cacheImg = {};
  function cargarImagen(rel) {
    if (!cacheImg[rel]) {
      cacheImg[rel] = App.api.get('/api/oficina/archivo', { ruta: rel }).then(function (c) {
        // el backend manda los .svg como texto: se convierten acá en imagen
        if (!c.base64 && typeof c.texto === 'string' && ext(rel) === 'svg' && !c.truncado) {
          var src = svgComoImagen(c.texto);
          if (src) return src;
        }
        if (!c.base64) throw new Error('sin vista');
        return 'data:' + c.mime + ';base64,' + c.base64;
      });
      cacheImg[rel].catch(function () { delete cacheImg[rel]; });
    }
    return cacheImg[rel];
  }
  /* abre un archivo de la oficina con el visor que le toque */
  function abrirArchivo(rel, alFallar) {
    var e = ext(rel), nombre = rel.split('/').pop(), fallo = alFallar || App.fallo;
    if (EXT_IMAGEN[e]) { cargarImagen(rel).then(function (src) { verImagen(src, nombre, rel); }, fallo); return; }
    // una página se dibuja empaquetada (/api/oficina/vista): el iframe aislado no puede pedir su CSS, JS ni imágenes
    var empaquetada = EXT_ARTEFACTO[e] === 'html'
      ? App.api.get('/api/oficina/vista', { ruta: rel }).then(function (r) { return r.vista; }, function () { return null; })
      : Promise.resolve(null);
    Promise.all([App.api.get('/api/oficina/archivo', { ruta: rel }), empaquetada]).then(function (rs) {
      var c = rs[0], v = rs[1];
      if (EXT_ARTEFACTO[e] && typeof c.texto === 'string') {
        if (c.truncado && !(v && v.html)) App.aviso('El archivo es largo: se muestra solo el principio.', true);
        var avisos = v && v.avisos || [];
        if (avisos.length) App.aviso(avisos.length === 1 ? avisos[0] : avisos[0] + ' (y ' + (avisos.length - 1) + ' más)', true);
        verArtefacto({ tipo: EXT_ARTEFACTO[e], codigo: c.texto, vista: v && v.html, titulo: nombre, nombre: nombre, ruta: c.ruta, rel: c.rel || rel });
      } else App.abrirContenido(c);
    }).catch(fallo);
  }

  /* ---------------- hidratar el HTML de App.markdown ---------------- */
  var LENGUAJES_ARTEFACTO = { html: 'html', htm: 'html', svg: 'svg', mermaid: 'mermaid', mmd: 'mermaid' };
  function tipoDeBloque(lang, codigo) {
    if (LENGUAJES_ARTEFACTO[lang]) return LENGUAJES_ARTEFACTO[lang];
    var t = codigo.trim();
    if ((lang === 'xml' || lang === '') && /^<svg[\s>]/i.test(t) && /<\/svg>\s*$/i.test(t)) return 'svg';
    if (lang === '' && /^<!doctype html/i.test(t)) return 'html';
    return null;
  }
  function svgComoImagen(codigo) {
    try { return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(codigo))); } catch (e) { return null; }
  }

  function hidratarCodigo(caja) {
    if (caja.dataset.listo) return;
    caja.dataset.listo = '1';
    var pre = caja.querySelector('pre'), codigo = pre ? pre.textContent : '';
    var lang = caja.dataset.lang || '', tipo = tipoDeBloque(lang, codigo);
    var cab = h('div.md-codigo-cab', h('span.md-codigo-lang', lang || 'código'),
      h('button.md-codigo-btn', { type: 'button', onclick: function () { copiar(codigo); } }, 'Copiar'));
    caja.insertBefore(cab, pre);
    if (!tipo) return;
    // artefacto: tarjeta con vista previa; el código queda plegado
    caja.classList.add('artefacto');
    pre.hidden = true;
    var titulo = tituloDe(tipo, codigo);
    var previa = null;
    if (tipo === 'svg') { var src = svgComoImagen(codigo); if (src) previa = h('img.artefacto-previa', { src: src, alt: titulo }); }
    var verCod = h('button.md-codigo-btn', { type: 'button', onclick: function () { pre.hidden = !pre.hidden; verCod.textContent = pre.hidden ? 'Código' : 'Ocultar código'; } }, 'Código');
    cab.insertBefore(verCod, cab.lastChild);
    var tarjeta = h('div.artefacto-tarjeta', { onclick: function () { verArtefacto({ tipo: tipo, codigo: codigo }); } },
      previa || h('div.artefacto-icono', tipo === 'html' ? '</>' : tipo === 'svg' ? '◆' : '⇄'),
      h('div.artefacto-txt', h('div.artefacto-titulo', titulo),
        h('div.artefacto-sub', tipo === 'html' ? 'Página HTML · clic para verla' : tipo === 'svg' ? 'Gráfico SVG · clic para agrandar' : 'Diagrama · clic para verlo')),
      h('button.btn.chico', { type: 'button' }, App.icono('abrir'), 'Ver'));
    caja.insertBefore(tarjeta, pre);
  }

  function hidratarImagen(img) {
    if (img.dataset.listo) return;
    img.dataset.listo = '1';
    var titulo = img.getAttribute('alt') || '';
    img.addEventListener('click', function () { if (img.src) verImagen(img.src, titulo); });
    var ruta = img.dataset.ruta;
    if (!ruta) {
      // imagen de la web que no carga: queda el enlace
      img.addEventListener('error', function () {
        var a = h('a.md-img-falta', { href: img.src, target: '_blank', rel: 'noopener noreferrer' }, App.icono('enlace'), titulo || 'Imagen', ' (no se pudo cargar)');
        if (img.parentNode) img.parentNode.replaceChild(a, img);
      });
      if (img.complete && img.naturalWidth === 0 && img.src) img.dispatchEvent(new Event('error'));
      return;
    }
    if (!ruta) return;
    var rel = relOficina(ruta);
    var nombre = normal(ruta).split('/').pop();
    var span = null;
    function sinVista(msg, extra) {
      span = h('span.md-img-falta', App.icono('clip'), titulo || nombre, msg ? ' (' + msg + ')' : '', extra || null);
      if (img.parentNode) img.parentNode.replaceChild(span, img);
    }
    function cargar(r) {
      img.classList.add('cargando');
      cargarImagen(r).then(function (src) {
        img.src = src; img.classList.remove('cargando');
        if (span && span.parentNode) { span.parentNode.replaceChild(img, span); span = null; }
      }, function () { sinVista('no se pudo mostrar'); });
    }
    if (rel === null) { sinVista('fuera de la oficina', botonTrabajo(ruta, cargar)); return; }
    cargar(rel);
  }

  /* `archivos/ventas/x.md` en el texto: si parece un archivo de la oficina, se abre con un clic (si no existe, avisa) */
  var PARECE_RUTA = /^[^\s`<>"|*?]+\/[^\s`<>"|*?\/]+\.[a-z0-9]{1,8}$/i;
  function hidratarRuta(code) {
    if (code.closest('pre, a, button')) return;
    var txt = code.textContent.trim();
    if (!PARECE_RUTA.test(txt) || (/^[a-z][a-z0-9+.-]*:\/\//i.test(txt) && !/^file:\/\//i.test(txt))) return;
    var rel = relOficina(txt);
    if (rel === null) return;
    var btn = h('button.md-ruta', { type: 'button', title: 'Abrir ' + rel, onclick: function () {
      abrirArchivo(rel, function () { App.aviso('No encontré «' + rel + '» en la oficina.', true); });
    } });
    code.parentNode.replaceChild(btn, code);
    btn.appendChild(code);
  }

  function hidratar(el) {
    Array.prototype.forEach.call(el.querySelectorAll('.md-codigo'), hidratarCodigo);
    Array.prototype.forEach.call(el.querySelectorAll('img.md-img'), hidratarImagen);
    Array.prototype.forEach.call(el.querySelectorAll('code'), hidratarRuta);
  }

  /* ---------------- pasos del agente ---------------- */
  var VERBOS = {
    Read: 'Leyó', Write: 'Escribió', Edit: 'Editó', MultiEdit: 'Editó', NotebookEdit: 'Editó', Glob: 'Buscó archivos',
    Grep: 'Buscó', Bash: 'Ejecutó un comando', WebFetch: 'Abrió', WebSearch: 'Buscó en la web', Task: 'Delegó una tarea',
    Agent: 'Delegó una tarea', TodoWrite: 'Actualizó su lista', Skill: 'Usó la skill', LS: 'Miró la carpeta'
  };
  var GERUNDIOS = {
    Read: 'Leyendo', Write: 'Escribiendo', Edit: 'Editando', MultiEdit: 'Editando', NotebookEdit: 'Editando', Glob: 'Buscando archivos',
    Grep: 'Buscando', Bash: 'Ejecutando un comando', WebFetch: 'Abriendo', WebSearch: 'Buscando en la web', Task: 'Delegando una tarea',
    Agent: 'Delegando una tarea', LS: 'Mirando la carpeta', Skill: 'Usando la skill'
  };
  function verbo(nombre) {
    if (VERBOS[nombre]) return VERBOS[nombre];
    var m = /^mcp__(.+?)__(.+)$/.exec(nombre || '');
    /* «Usó Google Calendar: list events» en vez del nombre interno de la herramienta */
    if (m) return /consult|colega/i.test(m[2]) ? 'Consultó a un colega' : 'Usó ' + App.humano.herramienta(nombre);
    return 'Usó ' + String(nombre || 'una herramienta').replace(/[_-]+/g, ' ');
  }
  /* el objetivo de un paso: si es una ruta, el nombre corto (la ruta completa va en el title) */
  var DE_ARCHIVO = /^(Read|Write|Edit|MultiEdit|NotebookEdit|LS|Glob)$/;
  function objetivoCorto(p) {
    var o = p.objetivo;
    if (!o) return '';
    return DE_ARCHIVO.test(p.nombre) || (/\//.test(o) && !/\s/.test(o)) ? App.humano.ruta(o).corta : o;
  }
  /* qué se le pidió a la herramienta (el comando de Bash, la búsqueda, la URL), para verlo desplegando la línea */
  var ETIQUETA_DETALLE = { Bash: 'Comando', Grep: 'Búsqueda', Glob: 'Búsqueda', WebFetch: 'Dirección', Task: 'Encargo', Agent: 'Encargo' };
  function lineaHerramienta(p) {
    var o = objetivoCorto(p);
    var partes = [h('span.paso-punto'), h('span', verbo(p.nombre)), o ? h('span.paso-obj', { title: p.objetivo !== o ? App.humano.ruta(p.objetivo).completa : '' }, o) : null];
    if (!p.detalle) return h('div.paso-herr', partes);
    var pre = h('pre.paso-detalle-cod', p.detalle);
    return h('details.paso-detalle',
      h('summary.paso-herr', partes),
      h('div.paso-detalle-caja',
        h('div.paso-detalle-cab', h('span', ETIQUETA_DETALLE[p.nombre] || 'Detalle'),
          h('button.md-codigo-btn', { type: 'button', onclick: function (ev) { ev.preventDefault(); copiar(p.detalle); } }, 'Copiar')),
        pre));
  }
  /* los pasos en orden: textos intermedios formateados y una línea por herramienta (los archivos van en tarjetas) */
  function listaPasos(pasos) {
    var cont = h('div.pasos-lista');
    (pasos || []).forEach(function (p) {
      if (p.t === 'texto') cont.appendChild(App.htmlSeguro(h('div.paso-texto'), App.markdown(p.c)));
      else if (p.t === 'herramienta') cont.appendChild(lineaHerramienta(p));
    });
    return cont;
  }
  function resumenPasos(pasos) {
    var herr = (pasos || []).filter(function (p) { return p.t === 'herramienta'; });
    if (!herr.length) return 'Lo que fue pensando';
    var ult = herr[herr.length - 1];
    return herr.length + (herr.length === 1 ? ' paso' : ' pasos') + ' · ' + verbo(ult.nombre) + (objetivoCorto(ult) ? ' ' + objetivoCorto(ult) : '');
  }
  /* plegado arriba de una respuesta terminada */
  function pasosPlegados(pasos) {
    if (!pasos || !pasos.some(function (p) { return p.t !== 'archivo'; })) return null;
    return h('details.pasos', h('summary', resumenPasos(pasos)), listaPasos(pasos));
  }

  /* tarjetas de los archivos que escribió (únicos, en orden); las imágenes con miniatura */
  function tarjetasArchivos(pasos) {
    var vistos = {}, lista = [];
    (pasos || []).forEach(function (p) {
      if (p.t !== 'archivo') return;
      var k = p.rel || p.nombre;
      if (!vistos[k]) { vistos[k] = 1; lista.push(p); }
    });
    if (!lista.length) return null;
    return h('div.archivos-chat', lista.map(function (p) {
      var e = ext(p.nombre), dentro = !!p.rel;
      var mini = h('div.archivo-chat-ic', App.icono(EXT_ARTEFACTO[e] ? 'abrir' : 'parte'));
      if (dentro && EXT_IMAGEN[e]) {
        cargarImagen(p.rel).then(function (src) { App.vaciar(mini).appendChild(h('img', { src: src, alt: '' })); }, function () {});
      }
      // afuera (con su ruta): se puede sumar su carpeta como de trabajo y queda abrible
      var rel = p.rel || (p.ruta ? relOficina(p.ruta) : null);
      dentro = rel !== null && rel !== undefined;
      var tarjeta = h('div.archivo-chat' + (dentro ? '' : '.fuera'), {
        role: dentro ? 'button' : null, tabindex: dentro ? '0' : null, title: dentro ? rel : 'Fuera de la oficina',
        onclick: dentro ? function () { abrirArchivo(rel); } : null,
        onkeydown: dentro ? function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrirArchivo(rel); } } : null
      }, mini, h('div.archivo-chat-txt', h('div.archivo-chat-nom', p.nombre),
        h('div.archivo-chat-sub', !dentro ? 'fuera de la oficina' : EXT_ARTEFACTO[e] ? 'Clic para ver' : EXT_IMAGEN[e] ? 'Imagen' : (rel.split('/').slice(0, -1).pop() ? 'En ' + rel.split('/').slice(0, -1).pop() : 'En la carpeta de la oficina'))),
        dentro ? h('button.archivo-chat-bajar', { type: 'button', title: 'Descargar ' + p.nombre, 'aria-label': 'Descargar ' + p.nombre,
          onclick: function (ev) { ev.stopPropagation(); App.descargar({ nombre: p.nombre, rel: rel }); },
          onkeydown: function (ev) { ev.stopPropagation(); } }, App.icono('bajar')) : null,
        !dentro && p.ruta ? botonTrabajo(p.ruta, function (r) { p.rel = r; var n = tarjetasArchivos([p]); if (n && tarjeta.parentNode) tarjeta.parentNode.replaceChild(n.firstChild, tarjeta); }) : null);
      return tarjeta;
    }));
  }

  /* burbuja de la respuesta que se está escribiendo: textos y herramientas a medida que llegan */
  function burbujaVivo(pasos, nombre) {
    var b = h('div.msg.a.vivo');
    if (!pasos || !pasos.length) {
      b.appendChild(h('div.escribiendo', h('span.puntos', h('i'), h('i'), h('i')), nombre + ' está pensando…'));
      return b;
    }
    b.appendChild(listaPasos(pasos));
    var ult = pasos[pasos.length - 1];
    b.appendChild(h('div.escribiendo', h('span.puntos', h('i'), h('i'), h('i')),
      ult.t === 'herramienta' ? (GERUNDIOS[ult.nombre] || (/^mcp__.*(consult|colega)/i.test(ult.nombre) ? 'Consultando a un colega' : 'Trabajando')) + (objetivoCorto(ult) ? ' ' + objetivoCorto(ult) : '') + '…' : 'escribiendo…'));
    var arch = tarjetasArchivos(pasos);
    if (arch) b.appendChild(arch);
    return b;
  }

  App.ChatRico = {
    hidratar: hidratar, relOficina: relOficina, verArtefacto: verArtefacto, verImagen: verImagen, abrirArchivo: abrirArchivo,
    pasosPlegados: pasosPlegados, tarjetasArchivos: tarjetasArchivos, burbujaVivo: burbujaVivo, documento: documento
  };
})();
