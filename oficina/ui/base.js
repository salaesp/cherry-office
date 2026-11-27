/* Base: API del backend, puente con la app nativa, utilidades de DOM, hojas, menús y avisos. */
window.App = window.App || {};
/* estado compartido entre módulos */
App.E = { estado: null, carpeta: null, oficina: null, ocupados: {}, reunion: null };
(function () {
  'use strict';

  /* ---------------- API ---------------- */
  function pedido(metodo, ruta, cuerpo) {
    var op = { method: metodo, headers: {} };
    if (cuerpo !== undefined) { op.headers['Content-Type'] = 'application/json'; op.body = JSON.stringify(cuerpo); }
    return fetch(ruta, op).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : {}; } catch (e) { d = null; }
        if (!r.ok) {
          var err = new Error((d && d.error) || ('Error ' + r.status));
          err.status = r.status; err.datos = d;
          throw err;
        }
        return d || {};
      });
    });
  }
  function qs(o) {
    var p = [];
    Object.keys(o || {}).forEach(function (k) { if (o[k] !== undefined && o[k] !== null && o[k] !== '') p.push(encodeURIComponent(k) + '=' + encodeURIComponent(o[k])); });
    return p.length ? '?' + p.join('&') : '';
  }
  App.api = {
    get: function (r, q) { return pedido('GET', r + qs(q)); },
    post: function (r, c) { return pedido('POST', r, c === undefined ? {} : c); },
    patch: function (r, c) { return pedido('PATCH', r, c); },
    put: function (r, c) { return pedido('PUT', r, c); },
    del: function (r, c) { return pedido('DELETE', r, c); }
  };

  /* ---------------- app nativa (WKWebView) ---------------- */
  var puente = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hq;
  var plataforma = (window.oficinaApp && window.oficinaApp.plataforma) || 'darwin';
  App.nativo = {
    hay: !!puente,
    /* «en Finder» (Mac) o «en el Explorador» (Windows) */
    enExplorador: plataforma === 'win32' ? 'en el Explorador' : plataforma === 'darwin' ? 'en Finder' : 'en la carpeta',
    /* abre un archivo o carpeta con la app predeterminada del sistema (solo rutas dentro de la oficina o vínculos) */
    abrir: function (ruta) { if (puente) puente.postMessage({ accion: 'abrir', ruta: ruta }); },
    revelar: function (ruta) { if (puente) puente.postMessage({ accion: 'revelar', ruta: ruta }); },
    acerca: function () { if (puente) puente.postMessage({ accion: 'acerca' }); },
    /* texto al portapapeles del sistema; resuelve true si la app lo copió (si no hay app o es una versión vieja, otra cosa) */
    copiar: function (texto) {
      if (!puente) return Promise.resolve(false);
      try { return Promise.resolve(puente.postMessage({ accion: 'copiar', texto: texto })); } catch (e) { return Promise.resolve(false); }
    },
    /* número en el ícono del Dock o de la barra de tareas (avisos pendientes); 0 lo saca */
    insignia: function (n) { if (puente) puente.postMessage({ accion: 'insignia', n: n | 0 }); },
    /* selector de un .zip (importar una oficina); undefined si no hay app nativa o falla, null si se cancela */
    elegirArchivo: function (titulo) {
      if (!puente) return Promise.resolve(undefined);
      try {
        return Promise.resolve(puente.postMessage({ accion: 'elegirArchivo', titulo: titulo }))
          .then(function (r) { return typeof r === 'string' && r ? r : null; });
      } catch (e) { return Promise.resolve(undefined); }
    },
    /* borra la oficina abierta y manda su carpeta a la papelera; undefined si no hay app nativa */
    borrarOficina: function (carpeta) {
      if (!puente) return Promise.resolve(undefined);
      try { return Promise.resolve(puente.postMessage({ accion: 'borrarOficina', carpeta: carpeta })); } catch (e) { return Promise.reject(e); }
    },
    /* acceso desde el celular (Ajustes › Celular): hacer = 'estado' | 'prender' | 'apagar' | 'probar'; undefined sin app */
    celular: function (hacer) {
      if (!puente) return Promise.resolve(undefined);
      try { return Promise.resolve(puente.postMessage({ accion: 'celular', hacer: hacer || 'estado' })); } catch (e) { return Promise.reject(e); }
    },
    elegirCarpeta: function (titulo, inicio, crear) {
      if (!puente) return Promise.resolve(undefined);
      try {
        return Promise.resolve(puente.postMessage({ accion: 'elegirCarpeta', titulo: titulo, inicio: inicio || null, crear: !!crear }))
          .then(function (r) { return typeof r === 'string' && r ? r : null; });
      } catch (e) { return Promise.resolve(undefined); }
    }
  };

  /* ---------------- DOM ---------------- */
  /* h('div.clase', {onclick, title, ...}, hijos...) — los textos van siempre como texto, nunca como HTML */
  function h(sel, attrs) {
    var partes = sel.split('.'), el = document.createElement(partes[0] || 'div');
    if (partes.length > 1) el.className = partes.slice(1).join(' ');
    var hijos = Array.prototype.slice.call(arguments, 2);
    if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) { hijos.unshift(attrs); attrs = null; }
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    agregar(el, hijos);
    return el;
  }
  function agregar(el, hijos) {
    hijos.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) agregar(el, c);
      else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
  }
  function vaciar(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  App.h = h; App.vaciar = vaciar;
  App.add = function (el) { agregar(el, Array.prototype.slice.call(arguments, 1)); return el; };   // como append, pero ignora null/false y aplana listas

  /* íconos de trazo fino (SVG inline) */
  var ICONOS = {
    mas: 'M12 5v14M5 12h14',
    copiar: 'M9 9h10v11H9zM5 15V4h10',
    puntos: 'M6 12h.01M12 12h.01M18 12h.01',
    abajo: 'M7 10l5 5 5-5',
    deslizadores: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
    ajustes: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    cerrar: 'M6 6l12 12M18 6L6 18',
    menu: 'M4 7h16M4 12h16M4 17h16',
    personas: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3 3 0 0 1 0 5.6',
    reunion: 'M4 6h16v9H8l-4 4zM8 10h8',
    charla: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 9.5h8M8 12.5h5',
    bombilla: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z',
    libro: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3',
    capas: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    carpeta: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    subir: 'M12 16V4M7 9l5-5 5 5M5 20h14',
    flechaArriba: 'M12 19V5M6 11l6-6 6 6',
    buscar: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    enviar: 'M5 12h13M13 6l6 6-6 6',
    parar: 'M7 7h10v10H7z',
    flecha: 'M9 6l6 6-6 6',
    atras: 'M15 6l-6 6 6 6',
    abrir: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    edificio: 'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3M3 21h18',
    chispa: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
    dado: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 9h.01M15 15h.01M15 9h.01M9 15h.01',
    papelera: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    importar: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    bajar: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    enlace: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
    recargar: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
    flujo: 'M5 4h4v4H5zM15 16h4v4h-4zM9 6h3a3 3 0 0 1 3 3v7M12 10h0',
    medidor: 'M4 16a8 8 0 1 1 16 0M12 16l3.5-4.5M7 19h10',
    reloj: 'M7 3h10M7 21h10M8 3v4l4 5-4 5v4M16 3v4l-4 5 4 5v4',
    regla: 'M4 6h16M4 12h10M4 18h6M17 14l2 2 3-4',
    enchufe: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
    escudo: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM9 12l2 2 4-4',
    parte: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
    lapiz: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    pin: 'M12 21s-6.5-5.8-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21zM12 12.3a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
    candado: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
    ok: 'M5 12.5l4.5 4.5L19 7',
    bandeja: 'M3 13h5l1.5 3h5l1.5-3h5M5.5 5h13L21 13v6H3v-6z',
    calendario: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4',
    hora: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    campana: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4',
    mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 7l8.5 6.5L20.5 7',
    alerta: 'M12 3l9.5 17h-19zM12 10v4.5M12 17.5v.01',
    telefono: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
    clip: 'M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7.1'
  };
  /* «hace 5 min»: acepta segundos epoch, milisegundos, un Date o una fecha ISO */
  App.hace = function (fecha) {
    var ms = fecha instanceof Date ? fecha.getTime() : typeof fecha === 'number' ? (fecha < 1e12 ? fecha * 1000 : fecha) : Date.parse(fecha);
    if (isNaN(ms)) return '';
    var s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'recién';
    if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
    return 'hace ' + Math.round(s / 86400) + ' d';
  };
  App.icono = function (n) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.7'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONOS[n] || ''); s.appendChild(p);
    return s;
  };
  /* logo: un edificio pixel con ventanas encendidas (16×16, sin suavizado) */
  App.logo = function () {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('class', 'logo'); s.setAttribute('shape-rendering', 'crispEdges');
    var r = function (x, y, w, h, c) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"/>'; }, v = '';
    v += r(2, 2, 9, 13, '#2a1f2e') + r(3, 3, 7, 12, '#e8a33d') + r(3, 3, 7, 1, '#f5c86a') + r(9, 3, 1, 12, '#c4822a');
    v += r(10, 6, 4, 9, '#2a1f2e') + r(11, 7, 2, 8, '#5d7da6') + r(11, 7, 2, 1, '#8eaed2');
    [[4, 5], [7, 5], [4, 8], [7, 8], [4, 11]].forEach(function (p) { v += r(p[0], p[1], 2, 2, '#fff3c4'); });
    v += r(7, 12, 2, 3, '#2a1f2e') + r(11, 9, 2, 1, '#fff3c4') + r(11, 12, 2, 1, '#fff3c4') + r(1, 15, 14, 1, '#2a1f2e');
    s.innerHTML = v; return s;
  };

  /* ---------------- avisos ---------------- */
  var tostadas = null;
  /* `accion` (opcional): {texto, fn} — un botón en la tostada, p. ej. «Deshacer» */
  App.aviso = function (texto, error, accion) {
    if (!tostadas) { tostadas = h('div.tostadas'); document.body.appendChild(tostadas); }
    var t = h('div.tostada' + (error ? '.error' : ''), h('span', texto),
      accion ? h('button.tostada-accion', { onclick: function () { t.remove(); accion.fn(); } }, accion.texto) : null);
    tostadas.appendChild(t);
    setTimeout(function () { t.remove(); }, error ? 6500 : accion ? 6000 : 3200);
  };
  /* ajustes que se guardan solos: «Guardado» con «Deshacer» */
  App.guardado = function (texto, deshacer) { App.aviso(texto || 'Guardado.', false, deshacer ? { texto: 'Deshacer', fn: deshacer } : null); };
  App.fallo = function (e) { App.aviso((e && e.message) || String(e), true); };

  /* ---------------- hojas modales (apiladas; Esc cierra la de arriba) ---------------- */
  /* Atrás cierra la hoja de arriba, como en una app: cada hoja deja una entrada en el historial (misma ruta, con la marca
     `hoja`). Cerrarla con su ✕ saca esa entrada; si mientras tanto se navegó a otra ruta, la hoja se cierra sola. */
  var pila = [], nHojas = 0;
  function alVolverHistorial(e) {
    var marca = e.state && e.state.hoja;
    for (var i = pila.length - 1; i >= 0; i--) { if (pila[i].marca === marca) break; pila[i].cerrar(true); }
  }
  window.addEventListener('popstate', alVolverHistorial);
  window.addEventListener('hashchange', function () {
    for (var i = pila.length - 1; i >= 0; i--) if (pila[i].ruta !== location.hash) pila[i].cerrar(true);
  });
  App.hoja = function (op) {
    var cuerpo = h('div.hoja-cuerpo'), pie = h('div.hoja-pie');
    var cab = h('div.hoja-cab', h('h2', op.titulo || ''), h('button.btn.fantasma.icono', { title: 'Cerrar', onclick: function () { cerrar(); } }, App.icono('cerrar')));
    var caja = h('div.hoja', { style: { width: (op.ancho || 560) + 'px', height: op.alto || null } }, cab, cuerpo, op.sinPie ? null : pie);
    var velo = h('div.velo', caja);
    var ajuste = moverYAgrandar(caja, cab, op);
    velo.addEventListener('mousedown', function (e) { if (e.target === velo && !op.modal) cerrar(); });
    document.body.appendChild(velo);
    var marca = 'h' + (++nHojas);
    var obj = { el: caja, cuerpo: cuerpo, pie: pie, cab: cab, cerrar: function () { cerrar(); }, titulo: function (t) { cab.firstChild.textContent = t; },
      restaurar: ajuste.restaurar, marca: marca, ruta: location.hash };
    try { history.pushState({ hoja: marca }, '', location.href); } catch (e) { obj.marca = null; }
    pila.push(obj);
    var cerrada = false;
    /* porHistorial: la cerró Atrás o un cambio de ruta (su entrada ya no está arriba: no hay que sacarla) */
    function cerrar(porHistorial) {
      if (cerrada) return; cerrada = true;
      velo.remove();
      pila.splice(pila.indexOf(obj), 1);
      /* si nadie navegó justo después (al cerrar se suele abrir otra cosa), se saca su entrada del historial */
      if (porHistorial !== true && obj.marca) setTimeout(function () { if (history.state && history.state.hoja === obj.marca) history.back(); }, 0);
      if (op.alCerrar) op.alCerrar();
    }
    /* el primer campo para escribir (no una hora ni un buscador de una lista larga, que se llevarían la vista hacia abajo) */
    if (!App.tactil()) setTimeout(function () { var f = caja.querySelector('[autofocus]') || caja.querySelector('input:not([type=time]):not([type=search]):not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select'); if (f) f.focus({ preventScroll: true }); }, 30);
    return obj;
  };
  App.hojaAbierta = function () { return pila.length > 0; };
  /* pantalla táctil sin mouse (el celular): ahí Enter no manda y las hojas no enfocan solas */
  App.tactil = function () { return !!App.movil || (window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches); };

  /* Hojas que se mueven (arrastrando la barra) y cambian de tamaño (desde los bordes y las esquinas). Sólo en la compu:
     en el celular son paneles que suben desde abajo. Al tocarla por primera vez la hoja deja de estar centrada y pasa a
     una posición fija (.suelta). Doble clic en la barra la devuelve a su tamaño y lugar de siempre.
     El tamaño se recuerda por tipo de hoja: `op.clave` o, si no hay, su ancho y alto pedidos (las que tienen alto fijo
     recuerdan el alto; las que crecen con su contenido, sólo el ancho). Lo de adentro se acomoda solo al ancho con
     container queries (container «hoja» en estilo.css). */
  var COMPU = window.matchMedia ? window.matchMedia('(min-width: 721px)') : { matches: true };
  var HOJA_MIN_W = 300, HOJA_MIN_H = 180, HOJA_ASOMA = 80;   // ASOMA: lo que queda siempre a la vista al sacarla del borde
  var BORDES = ['n', 's', 'e', 'o', 'ne', 'no', 'se', 'so'];
  function tamHoja(clave) { try { return JSON.parse(localStorage.getItem('oficina.hoja.' + clave) || 'null'); } catch (e) { return null; } }
  function guardarTamHoja(clave, t) { try { if (t) localStorage.setItem('oficina.hoja.' + clave, JSON.stringify(t)); else localStorage.removeItem('oficina.hoja.' + clave); } catch (e) {} }
  function entre(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function moverYAgrandar(caja, cab, op) {
    var clave = op.clave || ((op.ancho || 560) + 'x' + (op.alto || 'auto'));
    var anchoBase = (op.ancho || 560) + 'px', altoBase = op.alto || '';
    var guardado = COMPU.matches ? tamHoja(clave) : null;
    if (guardado && guardado.w) caja.style.width = guardado.w + 'px';
    if (guardado && guardado.h && op.alto) caja.style.height = guardado.h + 'px';
    BORDES.forEach(function (d) { caja.appendChild(h('div.hoja-borde', { 'data-dir': d })); });

    function poner(x, y, w, alto) {
      caja.style.left = Math.round(x) + 'px'; caja.style.top = Math.round(y) + 'px';
      caja.style.width = Math.round(w) + 'px'; caja.style.height = Math.round(alto) + 'px';
    }
    function soltar() {
      if (caja.classList.contains('suelta')) return;
      var r = caja.getBoundingClientRect();
      caja.classList.add('suelta');
      poner(r.left, r.top, r.width, r.height);
    }
    function restaurar() {
      caja.classList.remove('suelta');
      caja.style.left = ''; caja.style.top = '';
      caja.style.width = anchoBase; caja.style.height = altoBase;
      guardarTamHoja(clave, null);
    }
    /* si la ventana de la app se achica, la hoja suelta vuelve a entrar */
    function encajar() {
      if (!caja.isConnected) { window.removeEventListener('resize', encajar); COMPU.removeEventListener && COMPU.removeEventListener('change', alCambiar); return; }
      if (!caja.classList.contains('suelta')) return;
      var r = caja.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      var w = Math.min(r.width, vw), alto = Math.min(r.height, vh);
      poner(entre(r.left, HOJA_ASOMA - w, vw - HOJA_ASOMA), entre(r.top, 0, vh - cab.offsetHeight), w, alto);
    }
    function alCambiar() { if (!COMPU.matches && caja.classList.contains('suelta')) { caja.classList.remove('suelta'); caja.style.left = ''; caja.style.top = ''; } }
    window.addEventListener('resize', encajar);
    if (COMPU.addEventListener) COMPU.addEventListener('change', alCambiar);

    /* un arrastre: `paso(dx, dy, r0)` en cada movimiento, `fin()` al soltar */
    function arrastrar(e, cursor, paso, fin) {
      if (e.button !== 0 || !COMPU.matches) return;
      e.preventDefault();
      soltar();
      var x0 = e.clientX, y0 = e.clientY, r0 = caja.getBoundingClientRect(), el = e.currentTarget;
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      document.body.classList.add('arrastrando-hoja'); document.body.style.cursor = cursor;
      function mover(ev) { paso(ev.clientX - x0, ev.clientY - y0, r0); }
      function soltarle() {
        el.removeEventListener('pointermove', mover); el.removeEventListener('pointerup', soltarle); el.removeEventListener('pointercancel', soltarle);
        document.body.classList.remove('arrastrando-hoja'); document.body.style.cursor = '';
        if (fin) fin();
      }
      el.addEventListener('pointermove', mover); el.addEventListener('pointerup', soltarle); el.addEventListener('pointercancel', soltarle);
    }
    cab.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button, a, input, select, textarea')) return;
      arrastrar(e, 'grabbing', function (dx, dy, r0) {
        var vw = window.innerWidth, vh = window.innerHeight;
        poner(entre(r0.left + dx, HOJA_ASOMA - r0.width, vw - HOJA_ASOMA), entre(r0.top + dy, 0, vh - cab.offsetHeight), r0.width, r0.height);
      });
    });
    cab.addEventListener('dblclick', function (e) { if (!e.target.closest('button, a, input, select, textarea') && COMPU.matches) restaurar(); });
    Array.prototype.forEach.call(caja.querySelectorAll(':scope > .hoja-borde'), function (b) {
      var d = b.getAttribute('data-dir');
      b.addEventListener('pointerdown', function (e) {
        arrastrar(e, getComputedStyle(b).cursor, function (dx, dy, r0) {
          var vw = window.innerWidth, vh = window.innerHeight;
          var l = r0.left, r = r0.right, t = r0.top, bo = r0.bottom;
          if (d.indexOf('o') >= 0) l = entre(r0.left + dx, 0, r - HOJA_MIN_W);
          if (d.indexOf('e') >= 0) r = entre(r0.right + dx, l + HOJA_MIN_W, vw);
          if (d.indexOf('n') >= 0) t = entre(r0.top + dy, 0, bo - HOJA_MIN_H);
          if (d.indexOf('s') >= 0) bo = entre(r0.bottom + dy, t + HOJA_MIN_H, vh);
          poner(l, t, r - l, bo - t);
        }, function () {
          var r = caja.getBoundingClientRect();
          guardarTamHoja(clave, { w: Math.round(r.width), h: op.alto ? Math.round(r.height) : null });
        });
      });
    });
    return { restaurar: restaurar };
  }
  /* Para ver un archivo: al costado de la charla si hay una abierta (compu, sin otra hoja encima); si no, en una hoja */
  App.visor = function (op) {
    var v = !pila.length && App.Agente && App.Agente.abrirVisor ? App.Agente.abrirVisor(op) : null;
    return v || App.hoja(op);
  };
  /* Lo mismo que una hoja ({cuerpo, pie, cab, cerrar, titulo, el}) pero pintado en el panel principal, con su modo
     (p. ej. 'biblioteca'): para las pantallas que antes eran ventanas y ahora son una sección. */
  /* Cabecera única de los paneles: [volver] icono · título y bajada · acciones · [×].
     `volver`: {texto, accion} (siempre a la izquierda, con flecha). La × cierra la ventana y vuelve a la oficina
     (App.cerrarVentana). `cerrar` la reemplaza. */
  App.cabPanel = function (op) {
    var ico = op.icono ? (typeof op.icono === 'string' ? h('div.der-ico', App.icono(op.icono)) : op.icono) : null;
    return h('div.der-cab' + (op.clase ? '.' + op.clase : ''),
      op.volver ? h('button.btn.fantasma.chico.volver', { title: op.volver.titulo || op.volver.texto, 'aria-label': op.volver.titulo || op.volver.texto, onclick: op.volver.accion }, App.icono('atras'), h('span.volver-txt', op.volver.texto)) : null,
      ico,
      h('div.der-tit', h('h2', { title: op.titulo }, op.titulo || ''), op.sub ? h('div.sub', op.sub) : null),
      op.acciones && op.acciones.length ? h('div.der-acciones', op.acciones) : null,
      h('button.btn.fantasma.icono.cerrar-panel', { title: 'Cerrar', onclick: op.cerrar || App.cerrarVentana }, App.icono('cerrar')));
  };
  /* Accesibilidad sin tocar cada módulo: las filas que se tocan (divs con onclick) se pueden enfocar con Tab y abrir con
     Enter o Espacio, y los botones que son solo un ícono toman su `title` como nombre para los lectores de pantalla. */
  var CLICABLES = '.lista-item, .persona, .carpeta, .entrega-fila, .corrida-fila, .parte-fila, .archivo, .agente-cara';
  function accesible(raiz) {
    if (!raiz.querySelectorAll) return;
    var els = [raiz].concat([].slice.call(raiz.querySelectorAll(CLICABLES + ', button[title]')));
    els.forEach(function (el) {
      if (!el.matches) return;
      if (el.matches('button[title]') && !el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', el.title);
      else if (el.matches(CLICABLES) && el.tagName !== 'BUTTON' && !el.hasAttribute('tabindex')) { el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); }
    });
  }
  if (window.MutationObserver) {
    new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) accesible(n); }); }); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }
  document.addEventListener('keydown', function (e) {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches || !e.target.matches(CLICABLES) || e.target.tagName === 'BUTTON') return;
    e.preventDefault(); e.target.click();
  });
  /* Cmd/Ctrl+Enter en un campo de texto largo = apretar el botón principal del formulario (el de la hoja, o el más
     cercano si el campo está suelto). Los campos que ya manejan la tecla (chats, Creador, notas de revisión) la
     frenan antes con preventDefault y no llegan acá. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.defaultPrevented || e.isComposing) return;
    var t = e.target;
    if (!t || t.tagName !== 'TEXTAREA' || t.readOnly || t.disabled) return;
    var activo = function (cont) {
      var bs = cont.querySelectorAll('.btn.primario');
      for (var i = bs.length - 1; i >= 0; i--) if (!bs[i].disabled && bs[i].offsetParent !== null) return bs[i];
      return null;
    };
    var boton = null, hoja = t.closest('.hoja');
    if (hoja) boton = activo(hoja.querySelector('.hoja-pie') || hoja) || activo(hoja);
    else for (var n = t.parentElement, d = 0; n && n !== document.body && d < 4 && !boton; n = n.parentElement, d++) boton = activo(n);
    if (!boton) return;
    e.preventDefault(); boton.click();
  });

  /* Estado vacío con intención: qué es este lugar y qué podés hacer (un botón o varios) */
  App.vacio = function (icono, titulo, texto, botones) {
    return h('div.nav-vacio', icono ? App.icono(icono) : null, titulo ? h('b', titulo) : null, texto ? h('p', texto) : null,
      botones ? h('div.acciones', { style: { justifyContent: 'center' } }, botones) : null);
  };
  /* Fila de ajuste: título y ayuda a la izquierda (la ayuda ANTES del control), el control a la derecha */
  App.ajuste = function (titulo, ayuda, control) {
    return h('div.ajuste', h('div', h('div.ajuste-tit', titulo), ayuda ? h('div.ajuste-ayuda', ayuda) : null), h('div.ajuste-control', control));
  };

  /* Cargando con palabras: qué se está trayendo, no un giro suelto */
  App.cargando = function (texto) { return h('div.vacio.cargando', h('span.giro'), texto ? h('span', texto) : null); };

  /* Opciones a la vista (en vez de <select> o de una hoja para elegir).
     op: {opciones: [{valor, titulo, sub?, icono?, retrato?: agente, color?}], valor, alCambiar(valor), forma: 'chips'|'lista',
          multiple?: bool (valor = array), etiqueta?: texto para lectores}. Devuelve el elemento con .valor() y .poner(v).
     forma 'deslizador': las opciones van en orden (de menos a más) sobre una barra; las marcadas `aparte: true` (p. ej.
     «El de Claude Code») no son un punto de la escala y van como chip al lado.
     forma 'interruptor': para dos opciones, una pastilla que se prende o apaga (como en el celular). La primera opción es
     «prendido» y la segunda «apagado»; al lado se lee el nombre de la elegida (con `sinTexto`, solo la pastilla).
     forma 'segmento': pocas opciones cortas pegadas en una barra (una sola elegida), p. ej. «No · Leer · Actuar». */
  App.elegir = function (op) {
    if (op.forma === 'deslizador') return deslizador(op);
    if (op.forma === 'interruptor') return interruptor(op);
    if (op.forma === 'segmento') return segmento(op);
    var forma = op.forma || (op.opciones.some(function (o) { return o.sub; }) ? 'lista' : 'chips');
    var valor = op.multiple ? (op.valor || []).slice() : op.valor;
    var es = function (v) { return op.multiple ? valor.indexOf(v) >= 0 : valor === v; };
    var bs = op.opciones.map(function (o) {
      var marca = o.retrato ? App.retratoImg(o.retrato, 'retrato-mini', 48) : o.color ? h('span.punto', { style: { background: o.color } }) : o.icono ? App.icono(o.icono) : null;
      var b = forma === 'lista'
        ? h('button.opcion-ui', { type: 'button' }, marca, h('span.opcion-txt', h('b', o.titulo), o.sub ? h('span', o.sub) : null))
        : h('button.chip', { type: 'button', title: o.sub || '' }, marca, o.titulo);
      b.addEventListener('click', function () {
        if (op.multiple) { var i = valor.indexOf(o.valor); if (i >= 0) valor.splice(i, 1); else valor.push(o.valor); }
        else valor = o.valor;
        pintar();
        if (op.alCambiar) op.alCambiar(op.multiple ? valor.slice() : valor);
      });
      return b;
    });
    function pintar() {
      bs.forEach(function (b, i) { var si = es(op.opciones[i].valor); b.classList.toggle('sel', si); b.setAttribute('aria-pressed', si ? 'true' : 'false'); });
    }
    pintar();
    var el = h('div.elegir.' + (forma === 'lista' ? 'elegir-lista' : 'elegir-chips'), { role: 'group', 'aria-label': op.etiqueta || '' }, bs);
    el.valor = function () { return op.multiple ? valor.slice() : valor; };
    el.poner = function (v) { valor = op.multiple ? (v || []).slice() : v; pintar(); };
    return el;
  };
  function segmento(op) {
    var valor = op.valor;
    var bs = op.opciones.map(function (o) {
      return h('button.seg-op', { type: 'button', title: o.sub || '', disabled: !!op.desactivado, onclick: function () {
        if (o.valor === valor) return;
        valor = o.valor; pintar();
        if (op.alCambiar) op.alCambiar(valor);
      } }, o.titulo);
    });
    function pintar() {
      bs.forEach(function (b, i) { var si = op.opciones[i].valor === valor; b.classList.toggle('sel', si); b.setAttribute('aria-pressed', si ? 'true' : 'false'); });
    }
    pintar();
    var el = h('div.elegir.elegir-segmento' + (op.ancho ? '.ancho' : ''), { role: 'group', 'aria-label': op.etiqueta || '' }, bs);
    el.valor = function () { return valor; };
    el.poner = function (v) { valor = v; pintar(); };
    return el;
  }
  /* Interruptor solo (sin texto al lado) para un sí/no: App.interruptor(prendido, alCambiar(bool), etiqueta, desactivado?) */
  App.interruptor = function (si, alCambiar, etiqueta, desactivado) {
    var el = interruptor({ opciones: [{ valor: true, titulo: '' }, { valor: false, titulo: '' }], valor: !!si, alCambiar: alCambiar, etiqueta: etiqueta, sinTexto: true });
    if (desactivado) el.querySelector('button').disabled = true;
    return el;
  };
  /* Renglón de ajuste compacto: marca opcional · título y una línea de resumen · control a la derecha.
     op: {marca?: nodo, titulo, sub?: texto o nodo, subError?: bool, control?: nodo o lista, alTocar?, abierto?: bool (muestra el chevrón)} */
  App.renglon = function (op) {
    var chev = op.abierto === undefined ? null : h('span.renglon-chev', App.icono('abajo'));
    var el = h('div.renglon' + (op.alTocar ? '.tocable' : '') + (op.abierto ? '.abierto' : ''), op.alTocar ? { onclick: op.alTocar } : null,
      op.marca || null,
      h('div.renglon-txt', h('div.renglon-tit', op.titulo), op.sub ? h('div.renglon-sub' + (op.subError ? '.error' : ''), op.sub) : null),
      op.control ? h('div.renglon-ctl', { onclick: function (ev) { ev.stopPropagation(); } }, op.control) : null,
      chev);
    return el;
  };
  function interruptor(op) {
    var si = op.opciones[0], no = op.opciones[1];
    var valor = op.valor;
    var boton = h('button.interruptor', { type: 'button', role: 'switch', 'aria-label': op.etiqueta || '' }, h('span.interruptor-bola'));
    var texto = h('span.interruptor-txt');
    function pintar() {
      var prendido = valor === si.valor, o = prendido ? si : no;
      boton.setAttribute('aria-checked', prendido ? 'true' : 'false');
      boton.title = o.sub || '';
      texto.textContent = o.titulo;
    }
    function cambiar() {
      valor = valor === si.valor ? no.valor : si.valor;
      pintar();
      if (op.alCambiar) op.alCambiar(valor);
    }
    boton.addEventListener('click', cambiar);
    texto.addEventListener('click', cambiar);   // tocar el texto también lo cambia, como una etiqueta
    var el = h('div.elegir.elegir-interruptor', boton, op.sinTexto ? null : texto);
    pintar();
    el.valor = function () { return valor; };
    el.poner = function (v) { valor = v; pintar(); };
    return el;
  }
  /* Escala con barra: mientras se arrastra solo cambia el texto; alCambiar se llama al soltar (o al tocar un nombre). */
  function deslizador(op) {
    var escala = op.opciones.filter(function (o) { return !o.aparte; });
    var apartes = op.opciones.filter(function (o) { return o.aparte; });
    var valor = op.valor;
    var pos = function (v) { for (var i = 0; i < escala.length; i++) if (escala[i].valor === v) return i; return -1; };
    var ultimo = Math.max(0, pos(valor));   // dónde queda la barra si se elige una opción aparte
    var barra = h('input.desliz-barra', { type: 'range', min: 0, max: escala.length - 1, step: 1, 'aria-label': op.etiqueta || '' });
    var nombres = escala.map(function (o, i) {
      return h('button.desliz-nombre', { type: 'button', title: o.sub || '', onclick: function () { elegir(o.valor); } }, o.titulo);
    });
    var chips = apartes.map(function (o) {
      return h('button.chip', { type: 'button', title: o.sub || '', onclick: function () { elegir(o.valor); } }, o.titulo);
    });
    var sub = h('div.desliz-sub');
    /* lo que hace la opción elegida, pegado a la escala (no suelto debajo de toda la fila) */
    var escalaEl = h('div.desliz-escala', barra, h('div.desliz-nombres', nombres), sub);
    escalaEl.style.setProperty('--n', String(escala.length));
    function opcion(v) { return op.opciones.filter(function (o) { return o.valor === v; })[0]; }
    function mostrar(i) {   // i: punto de la escala que se ve elegido (−1 = una opción aparte)
      var o = i >= 0 ? escala[i] : opcion(valor);
      barra.style.setProperty('--lleno', (escala.length > 1 ? Math.max(i, 0) / (escala.length - 1) * 100 : 0) + '%');
      el.classList.toggle('aparte', i < 0);
      nombres.forEach(function (b, j) { b.classList.toggle('sel', j === i); });
      chips.forEach(function (b, j) { var si = apartes[j].valor === valor; b.classList.toggle('sel', si); b.setAttribute('aria-pressed', si ? 'true' : 'false'); });
      barra.setAttribute('aria-valuetext', o ? o.titulo : '');
      App.vaciar(sub);
      if (o && o.sub) App.add(sub, h('b', o.titulo), ' · ', o.sub);
      sub.hidden = !(o && o.sub);
    }
    function pintar() {
      var i = pos(valor);
      if (i >= 0) ultimo = i;
      barra.value = String(ultimo);
      mostrar(i);
    }
    function elegir(v) {
      if (v === valor) { pintar(); return; }
      valor = v; pintar();
      if (op.alCambiar) op.alCambiar(valor);
    }
    barra.addEventListener('input', function () { el.classList.remove('aparte'); mostrar(Number(barra.value)); });
    barra.addEventListener('change', function () { elegir(escala[Number(barra.value)].valor); });
    var el = h('div.elegir.elegir-desliz', { role: 'group', 'aria-label': op.etiqueta || '' },
      h('div.desliz-fila', escalaEl,
        chips.length ? h('div.desliz-apartes', chips) : null));
    pintar();
    el.valor = function () { return valor; };
    el.poner = function (v) { valor = v; pintar(); };
    return el;
  }

  /* Fila de algo que espera una decisión: marca (agente, icono o nodo) · título · bajada · estado · UN botón principal · «⋯».
     op: {marca, titulo, sub?, estado?: nodo, principal?: nodo, mas?: [ítems de App.menu], alTocar?, clase?} */
  App.filaDecision = function (op) {
    var marca = op.marca && op.marca.nodeType ? op.marca
      : op.marca && typeof op.marca === 'object' ? App.retratoImg(op.marca, 'retrato', 64)
      : h('div.fila-ico', App.icono(op.marca || 'chispa'));
    var mas = op.mas && op.mas.filter(Boolean).length ? h('button.btn.fantasma.icono.chico', { title: 'Más opciones', onclick: function (ev) { ev.stopPropagation(); App.menu(ev.currentTarget, op.mas.filter(Boolean)); } }, App.icono('puntos')) : null;
    return h('div.fila-dec' + (op.clase ? '.' + op.clase : '') + (op.alTocar ? '.tocable' : ''), op.alTocar ? { onclick: op.alTocar } : null,
      marca,
      h('div.fila-txt', h('div.fila-tit', op.titulo), op.sub ? h('div.fila-sub', op.sub) : null),
      op.estado || null,
      op.principal ? h('div.fila-acc', { onclick: function (ev) { ev.stopPropagation(); } }, op.principal) : null,
      mas);
  };
  /* Sección con título, cuenta y una acción para todas (p. ej. «Encargar todo») */
  App.seccion = function (titulo, hijos, op) {
    op = op || {};
    return h('section.seccion-ui',
      h('h4.seccion-tit', h('span', titulo), op.cuenta ? h('span.cuenta', op.cuenta) : null, op.accion ? h('span.seccion-acc', op.accion) : null),
      op.ayuda ? h('div.seccion-ayuda', op.ayuda) : null,
      hijos);
  };

  /* Lista de textos cortos como chips: «×» para quitar y «+ Agregar» que se vuelve campo.
     op: {fijos?: [{texto, title?, icono?, accion?}], placeholder, alCambiar(items), max?}. `items` (array de strings) se modifica. */
  App.chipsEditables = function (items, op) {
    op = op || {};
    var caja = h('div.chips-ed');
    function pintar() {
      App.vaciar(caja);
      (op.fijos || []).forEach(function (f) {
        caja.appendChild(h(f.accion ? 'button.chip.fijo' : 'span.chip.fijo', { title: f.title || '', onclick: f.accion || null }, App.icono(f.icono || 'candado'), f.texto));
      });
      items.forEach(function (t, i) {
        caja.appendChild(h('span.chip', { title: op.titulo ? op.titulo(t) : t }, h('span.chip-txt', op.mostrar ? op.mostrar(t) : t),
          h('button.chip-x', { type: 'button', title: 'Quitar', onclick: function () {
            var quitado = items.splice(i, 1)[0]; pintar(); if (op.alCambiar) op.alCambiar(items, { quitado: quitado, pos: i });
          } }, '×')));
      });
      if (op.agregar !== false && (!op.max || items.length < op.max)) {
        var mas = h('button.chip.agregar', { type: 'button' }, App.icono('mas'), op.textoAgregar || 'Agregar');
        mas.addEventListener('click', function () {
          var inp = h('input.campo.chico.chip-campo', { placeholder: op.placeholder || '', maxlength: op.largo || 160 });
          caja.replaceChild(inp, mas); inp.focus();
          function listo(guardar) {
            var v = inp.value.trim();
            if (guardar && v && items.indexOf(v) < 0) { items.push(v); if (op.alCambiar) op.alCambiar(items, { agregado: v }); }
            pintar();
          }
          inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); listo(true); } if (e.key === 'Escape') { e.stopPropagation(); listo(false); } });
          inp.addEventListener('blur', function () { listo(true); });
        });
        caja.appendChild(mas);
      }
    }
    pintar();
    caja.repintar = pintar;
    return caja;
  };

  /* Traductor único de lo interno a lo humano (reglas de permiso, herramientas, rutas, ids). Lo crudo va solo en el title. */
  App.humano = (function () {
    var VERBOS = { Bash: 'correr', Edit: 'editar', Write: 'crear', MultiEdit: 'editar', NotebookEdit: 'editar notebooks', Read: 'leer', WebFetch: 'abrir páginas', WebSearch: 'buscar en la web' };
    function carpeta(p) {
      var c = String(p || '').replace(/^\/\//, '/').replace(/\/\*\*$/, '').replace(/\/\*$/, '');
      var of = App.E && App.E.carpeta ? App.E.carpeta.replace(/\/$/, '') : '';
      if (of && c.indexOf(of) === 0) c = c.slice(of.length).replace(/^\//, '') || 'la carpeta de la oficina';
      var home = (c.match(/^\/Users\/[^/]+|^\/home\/[^/]+/) || [])[0];
      if (home) c = '~' + c.slice(home.length);
      return c;
    }
    /* «Bash(git pull:*)» → {tipo:'correr', texto:'git pull'}; «Edit(//x/**)» → {tipo:'escribir', texto:'x'} */
    function regla(r) {
      var m = /^([A-Za-z]+)\((.*)\)$/.exec(r || '');
      if (!m) {
        if (/^mcp__/.test(r)) return { tipo: 'conector', texto: herramienta(r), crudo: r };
        return { tipo: 'otro', texto: VERBOS[r] ? 'Puede ' + VERBOS[r] : 'Otro permiso', crudo: r };
      }
      if (m[1] === 'Bash') { var cmd = m[2].replace(/:\*$/, ''); return { tipo: 'correr', texto: cmd.length > 40 ? cmd.slice(0, 39) + '…' : cmd, crudo: r }; }
      if (m[1] === 'Edit' || m[1] === 'Write' || m[1] === 'MultiEdit') return { tipo: 'escribir', texto: carpeta(m[2]), crudo: r };
      return { tipo: 'otro', texto: (VERBOS[m[1]] ? 'Puede ' + VERBOS[m[1]] : m[1]) + ' ' + carpeta(m[2]), crudo: r };
    }
    /* agrupa: Edit y Write de la misma carpeta son un solo ítem; devuelve [{tipo, texto, reglas:[crudas]}] */
    function reglas(lista) {
      var out = [], por = {};
      (lista || []).forEach(function (r) {
        var x = regla(r), k = x.tipo + '|' + x.texto;
        if (por[k]) por[k].reglas.push(r);
        else { por[k] = { tipo: x.tipo, texto: x.texto, reglas: [r] }; out.push(por[k]); }
      });
      return out;
    }
    function titulo(s) { s = String(s || '').replace(/[_-]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
    /* «mcp__claude_ai_Gmail__send_message» → «Gmail: send message» */
    function herramienta(n) {
      n = String(n || '');
      var m = /^mcp__(.+?)__(.+)$/.exec(n);
      if (!m) return VERBOS[n] ? titulo(VERBOS[n]) : titulo(n);
      var srv = m[1].replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '');
      return titulo(srv) + ': ' + m[2].replace(/_/g, ' ');
    }
    function conector(n) { var m = /^mcp__(.+?)__/.exec(String(n || '')); return m ? titulo(m[1].replace(/^claude_ai_/, '')) : herramienta(n); }
    /* ruta → nombre corto (el resto va en el title) */
    function ruta(p) { var s = String(p || '').replace(/\/$/, ''); return { corta: s.split('/').pop() || s, completa: carpeta(s) }; }
    function quien(id) { var a = id && App.agente && App.agente(id); return a ? a.nombre : id === 'persona' || id === 'usuario' ? 'Vos' : 'alguien que ya no está'; }
    return { regla: regla, reglas: reglas, herramienta: herramienta, conector: conector, ruta: ruta, carpeta: carpeta, quien: quien };
  })();

  /* Barra de acciones (pies de panel y de hoja): `izq` a la izquierda, el resto a la derecha; la última es la principal. */
  App.acciones = function (izq, der) {
    return h('div.acciones', izq && izq.length ? h('div.izq', izq) : null, der || null);
  };

  App.hojaEnPanel = function (op, modo) {
    if (!App.dom || !App.dom.derecho) return App.hoja(op);
    var der = App.dom.derecho;
    var cuerpo = h('div.der-cuerpo.hoja-panel-cuerpo'), pie = h('div.der-pie');
    var cab = App.cabPanel({ clase: 'hoja-panel-cab', icono: op.icono, titulo: op.titulo, sub: op.sub, acciones: op.acciones, cerrar: function () { if (op.alCerrar) op.alCerrar(); App.cerrarVentana(); } });
    var el = h('div.hoja-panel', cab, cuerpo, op.sinPie ? null : pie);
    App.add(App.vaciar(der), el);
    var obj = { el: el, cuerpo: cuerpo, pie: pie, cab: cab, enPanel: true,
      cerrar: function () { if (der.contains(el)) App.cerrarDerecho(); if (op.alCerrar) op.alCerrar(); },
      titulo: function (t) { cab.querySelector('h2').textContent = t; } };
    App.abrirDerecho(modo);
    return obj;
  };
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    if (emergente) { cerrarEmergente(); e.preventDefault(); return; }
    if (pila.length) { pila[pila.length - 1].cerrar(); e.preventDefault(); return; }
    var paleta = document.querySelector('.cmdk-velo');
    if (paleta) { paleta.remove(); e.preventDefault(); return; }
    /* escribiendo en un campo, el primer Esc sólo lo suelta (no se pierde lo escrito); el siguiente cierra la ventana */
    var a = document.activeElement;
    if (a && a !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || (a && a.isContentEditable)) { a.blur(); e.preventDefault(); return; }
    if (App.alEscape) App.alEscape();
  });

  App.confirmar = function (titulo, texto, boton, peligro) {
    return new Promise(function (ok) {
      var res = false;
      var hj = App.hoja({ titulo: titulo, ancho: 420, alCerrar: function () { ok(res); } });
      hj.cuerpo.appendChild(h('p', { style: { color: 'var(--suave)' } }, texto));
      hj.pie.appendChild(h('button.btn', { onclick: function () { hj.cerrar(); } }, 'Cancelar'));
      hj.pie.appendChild(h('button.btn.primario' + (peligro ? '.peligro' : ''), {
        autofocus: true,
        onclick: function () { res = true; hj.cerrar(); }
      }, boton || 'Aceptar'));
    });
  };

  App.preguntar = function (titulo, etiqueta, valor) {
    return new Promise(function (ok) {
      var res = null, inp = h('input.campo', { value: valor || '', autofocus: true });
      var hj = App.hoja({ titulo: titulo, ancho: 400, alCerrar: function () { ok(res); } });
      function listo() { res = inp.value.trim() || null; hj.cerrar(); }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') listo(); });
      App.add(hj.cuerpo, h('label.etiqueta-campo', etiqueta || ''), inp);
      App.add(hj.pie, h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), h('button.btn.primario', { onclick: listo }, 'Aceptar'));
    });
  };

  /* ---------------- menús emergentes ---------------- */
  var emergente = null;
  function cerrarEmergente() { if (emergente) { emergente.remove(); emergente = null; } }
  App.emergente = function (ancla, contenido, clase) {
    cerrarEmergente();
    var r = ancla.getBoundingClientRect();
    emergente = h('div.emergente' + (clase ? '.' + clase : ''), contenido);
    document.body.appendChild(emergente);
    var w = emergente.offsetWidth, hh = emergente.offsetHeight;
    var x = Math.min(r.left, window.innerWidth - w - 8), y = r.bottom + 6;
    if (y + hh > window.innerHeight - 8) y = Math.max(8, r.top - hh - 6);
    emergente.style.left = Math.max(8, x) + 'px'; emergente.style.top = y + 'px';
    setTimeout(function () {
      document.addEventListener('mousedown', function fuera(e) {
        if (emergente && !emergente.contains(e.target)) { cerrarEmergente(); }
        document.removeEventListener('mousedown', fuera, true);
      }, true);
    }, 0);
    return { cerrar: cerrarEmergente };
  };
  /* Menú: con tope de alto y scroll, ↑↓ y Enter, y un filtro arriba cuando pasa de 8 opciones.
     Ítems: '-' (separador), {titulo}, {texto, icono?, nota?, accion, peligro?, retrato?: agente} */
  App.menu = function (ancla, items) {
    var botones = [];
    var cuerpo = h('div.menu-cuerpo', items.map(function (it) {
      if (it === '-') return h('div.menu-sep');
      if (it.titulo) return h('div.menu-tit', it.titulo);
      var b = h('button.menu-item' + (it.peligro ? '.peligro' : ''), { onclick: function () { m.cerrar(); it.accion(); } },
        it.retrato ? App.retratoImg(it.retrato, 'retrato-mini', 48) : it.icono ? App.icono(it.icono) : null, h('span.menu-txt', it.texto), it.nota ? h('small', it.nota) : null);
      b._buscar = ((it.texto || '') + ' ' + (it.nota || '')).toLowerCase();
      botones.push(b);
      return b;
    }));
    var filtro = botones.length > 8 ? h('input.campo.chico.menu-filtro', { placeholder: 'Filtrar…' }) : null;
    var m = App.emergente(ancla, h('div', filtro, cuerpo), 'menu');
    function visibles() { return botones.filter(function (b) { return !b.classList.contains('oculto'); }); }
    if (filtro) {
      filtro.addEventListener('input', function () {
        var q = filtro.value.trim().toLowerCase();
        botones.forEach(function (b) { b.classList.toggle('oculto', !!q && b._buscar.indexOf(q) < 0); });
      });
      setTimeout(function () { filtro.focus(); }, 0);
    } else if (botones[0]) setTimeout(function () { botones[0].focus(); }, 0);
    var caja = cuerpo.parentNode;
    caja.addEventListener('keydown', function (e) {
      var vs = visibles(), i = vs.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (vs[i + 1] || vs[0] || {}).focus && (vs[i + 1] || vs[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) { if (filtro) filtro.focus(); else if (vs.length) vs[vs.length - 1].focus(); } else vs[i - 1].focus(); }
      else if (e.key === 'Enter' && document.activeElement === filtro && vs[0]) { e.preventDefault(); vs[0].click(); }
    });
    return m;
  };

  /* clic derecho sobre un mensaje del chat (tuyo o del agente): copiar la selección o el mensaje entero.
     El texto del mensaje sale de data-texto (el original, con su markdown) si lo hay; si no, del texto visible. */
  /* Copiar al portapapeles. En la app de escritorio la página corre en hq://app y Chromium rechaza navigator.clipboard
     ahí, así que primero va por el portapapeles nativo (Electron); en el navegador, por la API y si no, execCommand. */
  function copiarViejo(texto) {
    var ta = h('textarea', { style: { position: 'fixed', top: '-1000px', opacity: '0' } });
    ta.value = texto; document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
  }
  App.copiarTexto = function (texto) {
    texto = texto == null ? '' : String(texto);
    var nativo = App.nativo.copiar(texto).then(function (ok) { if (ok !== true) throw new Error('nativo'); });
    nativo.catch(function () { return navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject(); })
      .catch(function () { return copiarViejo(texto); })
      .then(function () { App.aviso('Copiado.'); }, function () { App.aviso('No se pudo copiar.', true); });
  };
  document.addEventListener('contextmenu', function (e) {
    var msg = e.target.closest && e.target.closest('.msg');
    if (!msg) return;
    e.preventDefault();
    var sel = window.getSelection(), elegido = sel && !sel.isCollapsed && msg.contains(sel.anchorNode) ? sel.toString() : '';
    var punto = { getBoundingClientRect: function () { return { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY - 6 }; } };
    var items = [];
    if (elegido.trim()) items.push({ texto: 'Copiar selección', icono: 'copiar', accion: function () { App.copiarTexto(elegido); } });
    items.push({ texto: 'Copiar mensaje', icono: 'copiar', accion: function () { App.copiarTexto(msg.dataset.texto || msg.innerText.trim()); } });
    App.menu(punto, items);
  });

  /* ---------------- utilidades ---------------- */
  App.uuid = function () {
    if (window.crypto && crypto.randomUUID) { try { return crypto.randomUUID(); } catch (e) {} }
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var x = Array.prototype.map.call(b, function (n) { return (n < 16 ? '0' : '') + n.toString(16); }).join('');
    return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
  };
  App.slug = function (s, usados) {
    var base = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'agente';
    var c = base, n = 2;
    for (var i = 0; i < 200 && usados && usados.indexOf(c) >= 0; i++) c = base.slice(0, 36) + '-' + (n++);
    return c;
  };
  App.fecha = function (iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var hoy = new Date(), mismo = d.toDateString() === hoy.toDateString();
    return mismo ? d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  };
  App.tam = function (b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; };
  App.debounce = function (fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; };

  /* Markdown seguro: se escapa todo y después se aplican las marcas. Sin HTML crudo; los enlaces solo http(s) y mailto
     (los abre el navegador del sistema). Soporta títulos, párrafos, listas anidadas y de tareas, citas, tablas,
     código, separadores, negrita, cursiva, tachado y enlaces. */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function enlace(u, texto) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + texto + '</a>'; }
  /* `![alt](src)`: imágenes de la web, `data:image/…` o rutas de archivos (de la oficina: las carga chat-rico.js).
     Cualquier otro esquema (javascript:, file:…) no es imagen y queda como texto. */
  function imagen(u, alt) {
    var a = ' alt="' + esc(alt) + '"';
    if (/^https?:\/\//i.test(u) || /^data:image\/[\w.+-]+[;,]/i.test(u)) return '<img class="md-img" src="' + esc(u) + '"' + a + ' loading="lazy">';
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[a-z]:[\\/]/i.test(u)) return null;
    return '<img class="md-img" data-ruta="' + esc(u) + '"' + a + '>';
  }
  function enLinea(s) {
    var guardado = [];
    function guardar(html) { guardado.push(html); return '\u0000' + (guardado.length - 1) + '\u0000'; }
    s = String(s).replace(/\u0000/g, '')
      .replace(/`([^`\n]{1,500})`/g, function (_, c) { return guardar('<code>' + esc(c) + '</code>'); })
      .replace(/!\[([^\]\n]{0,300})\]\(\s*<?([^\s)>]{1,4000})>?(?:\s+"[^"\n]*")?\s*\)/g, function (m, t, u) { var img = imagen(u, t); return img ? guardar(img) : m; })
      .replace(/\[([^\]\n]{1,300})\]\(\s*<?((?:https?:\/\/|mailto:)[^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)/g, function (_, t, u) { return guardar('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">') + t + guardar('</a>'); })
      .replace(/<((?:https?:\/\/|mailto:)[^\s<>]+)>/g, function (_, u) { return guardar(enlace(u, esc(u))); })
      .replace(/(^|[\s(])(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_])/g, function (_, a, u) { return a + guardar(enlace(u, esc(u))); });
    return esc(s)
      .replace(/\*\*(?=\S)([^\n]{1,300}?\S)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^\w])__(?=\S)([^\n]{1,300}?\S)__(?!\w)/g, '$1<b>$2</b>')
      .replace(/~~(?=\S)([^~\n]{1,300}?\S)~~/g, '<s>$1</s>')
      .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]{0,200}?[^\s*])?\*(?![\w*])/g, function (m, a, t, i) { return t === undefined ? m : a + '<i>' + t + '</i>'; })
      .replace(/(^|[^\w])_(?=\S)([^_\n]{1,200}?\S)?_(?!\w)/g, function (m, a, t) { return t === undefined ? m : a + '<i>' + t + '</i>'; })
      .replace(/\u0000(\d+)\u0000/g, function (_, n) { return guardado[+n]; });
  }
  function celdas(l) {
    l = l.trim().replace(/^\|/, '').replace(/\|$/, '');
    return l.replace(/\\\|/g, '\u0001').split('|').map(function (c) { return c.trim().replace(/\u0001/g, '|'); });
  }
  var RE_SEP_TABLA = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
  var RE_ITEM = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/;
  App.markdown = function (texto) {
    var lineas = String(texto || '').replace(/\r\n?/g, '\n').split('\n'), out = [], parrafo = [], listas = [];
    function cerrarP() { if (parrafo.length) { out.push('<p>' + parrafo.map(enLinea).join('<br>') + '</p>'); parrafo = []; } }
    function cerrarL(hasta) {
      hasta = hasta || 0;
      while (listas.length > hasta) out.push('</li></' + listas.pop().tipo + '>');
    }
    function cerrarTodo() { cerrarP(); cerrarL(); }
    function item(m) {
      var ind = m[1].replace(/\t/g, '    ').length, tipo = /\d/.test(m[2]) ? 'ol' : 'ul', cont = m[3];
      while (listas.length && ind < listas[listas.length - 1].ind) cerrarL(listas.length - 1);
      var tope = listas[listas.length - 1];
      if (tope && ind === tope.ind && tope.tipo !== tipo) { cerrarL(listas.length - 1); tope = listas[listas.length - 1]; }
      if (!tope || ind > tope.ind) {
        var ini = tipo === 'ol' ? parseInt(m[2], 10) : 1;
        out.push('<' + tipo + (ini !== 1 ? ' start="' + ini + '"' : '') + '>');
        listas.push({ tipo: tipo, ind: ind });
      } else out.push('</li>');
      var t = /^\[([ xX])\]\s+(.*)$/.exec(cont);
      if (t) out.push('<li class="tarea"><input type="checkbox" disabled' + (t[1] !== ' ' ? ' checked' : '') + '> ' + enLinea(t[2]));
      else out.push('<li>' + enLinea(cont));
    }
    for (var i = 0; i < lineas.length; i++) {
      var l = lineas[i], m;
      if ((m = /^\s*(```+|~~~+)\s*([\w+#.-]{0,30})/.exec(l))) {
        cerrarTodo();
        var cerca = m[1], cod = [];
        for (i++; i < lineas.length && lineas[i].trim().indexOf(cerca) !== 0; i++) cod.push(lineas[i]);
        out.push('<div class="md-codigo" data-lang="' + esc(m[2].toLowerCase()) + '"><pre><code>' + esc(cod.join('\n')) + '</code></pre></div>');
        continue;
      }
      if (!l.trim()) { cerrarP(); if (listas.length && !(i + 1 < lineas.length && (RE_ITEM.test(lineas[i + 1]) || /^\s{2,}\S/.test(lineas[i + 1])))) cerrarL(); continue; }
      if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) { cerrarTodo(); var n = Math.min(m[1].length + 1, 5); out.push('<h' + n + '>' + enLinea(m[2]) + '</h' + n + '>'); continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { cerrarTodo(); out.push('<hr>'); continue; }
      if (/^\s{0,3}>/.test(l)) {
        cerrarTodo();
        var cita = [];
        for (; i < lineas.length && /^\s{0,3}>/.test(lineas[i]); i++) cita.push(lineas[i].replace(/^\s{0,3}>\s?/, ''));
        i--;
        out.push('<blockquote>' + App.markdown(cita.join('\n')) + '</blockquote>');
        continue;
      }
      if (l.indexOf('|') >= 0 && i + 1 < lineas.length && RE_SEP_TABLA.test(lineas[i + 1]) && lineas[i + 1].indexOf('-') >= 0) {
        cerrarTodo();
        var cab = celdas(l), alin = celdas(lineas[i + 1]).map(function (c) { return /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''; });
        function fila(cs, tag) {
          return '<tr>' + cab.map(function (_, k) { var a = alin[k] ? ' style="text-align:' + alin[k] + '"' : ''; return '<' + tag + a + '>' + enLinea(cs[k] || '') + '</' + tag + '>'; }).join('') + '</tr>';
        }
        var filas = [];
        for (i += 2; i < lineas.length && lineas[i].trim() && lineas[i].indexOf('|') >= 0; i++) filas.push(fila(celdas(lineas[i]), 'td'));
        i--;
        out.push('<div class="md-tabla"><table><thead>' + fila(cab, 'th') + '</thead><tbody>' + filas.join('') + '</tbody></table></div>');
        continue;
      }
      if ((m = RE_ITEM.exec(l))) { cerrarP(); item(m); continue; }
      if (listas.length && /^\s+\S/.test(l)) { out.push('<br>' + enLinea(l.trim())); continue; }
      cerrarL(); parrafo.push(l);
    }
    cerrarTodo();
    return out.join('');
  };
  App.htmlSeguro = function (el, html) {   // solo con salida de App.markdown
    el.innerHTML = html; el.classList.add('md');
    if (App.ChatRico) App.ChatRico.hidratar(el);   // imágenes de la oficina, botones de código y artefactos
    return el;
  };

  /* ---------- bajar archivos ----------
     Los visores muestran el archivo, pero quien usa la oficina desde otra compu no puede abrir la ruta local: «Descargar»
     lo baja con su nombre. Si se sabe su ruta en la oficina (`rel`), se pide entero a /api/oficina/descarga (la vista
     previa puede venir cortada); si no, se baja lo que ya está en memoria (texto, base64 o una URL data:/blob:). */
  function bajarBlob(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: nombre || 'archivo' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function bytesDe(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  App.bajarContenido = function (c) {
    bajarBlob(new Blob([bytesDe(c.base64)], { type: c.mime || 'application/octet-stream' }), c.nombre);
  };
  /* op: {nombre, rel?, texto?, truncado?, base64?, mime?, url?} */
  App.descargar = function (op) {
    var nombre = op.nombre || 'archivo';
    if (op.rel) return App.api.get('/api/oficina/descarga', { ruta: op.rel }).then(App.bajarContenido).catch(App.fallo);
    if (op.base64) { App.bajarContenido({ nombre: nombre, mime: op.mime, base64: op.base64 }); return; }
    if (typeof op.texto === 'string' && !op.truncado) { bajarBlob(new Blob([op.texto], { type: (op.mime || 'text/plain') + ';charset=utf-8' }), nombre); return; }
    if (op.url) {
      return fetch(op.url).then(function (r) { if (!r.ok) throw new Error(); return r.blob(); })
        .then(function (b) { bajarBlob(b, nombre); }, function () { App.aviso('No se pudo bajar el archivo.', true); });
    }
    App.aviso('No se pudo bajar el archivo completo.', true);
  };
  App.botonDescargar = function (op) {
    return h('button.btn', { title: 'Bajar el archivo a esta compu', onclick: function () { App.descargar(op); } }, App.icono('bajar'), 'Descargar');
  };

  /* visor de documentos dentro de la app: markdown formateado (con opción de ver el texto) o texto plano */
  App.esMarkdown = function (nombre) { return /\.(md|markdown|mdown|mkd)$/i.test(nombre || ''); };
  App.verDocumento = function (op) {
    var md = op.markdown !== false && App.esMarkdown(op.nombre), crudo = !md;
    var hj = App.visor({ titulo: op.titulo || op.nombre || 'Documento', ancho: 820, alto: '86vh' });
    hj.el.classList.add('hoja-doc');
    var vista = h('div.md-doc');
    function pintar() {
      App.vaciar(vista);
      if (crudo) { vista.classList.remove('md'); vista.appendChild(h('pre.md-crudo', op.texto || '')); }
      else App.htmlSeguro(vista, App.markdown(op.texto || ''));
      if (op.truncado) vista.appendChild(h('div.ayuda', { style: { marginTop: '12px' } }, 'El archivo es largo: se muestra solo el principio.'));
      if (alternar) alternar.textContent = crudo ? 'Ver formateado' : 'Ver texto';
    }
    var alternar = md ? h('button.btn.izq', { onclick: function () { crudo = !crudo; pintar(); hj.cuerpo.scrollTop = 0; } }) : null;
    hj.cuerpo.appendChild(vista);
    App.add(hj.pie, alternar,
      h('button.btn', { onclick: function () {
        App.copiarTexto(op.texto || '');
      } }, 'Copiar'),
      App.botonDescargar({ nombre: op.nombre || op.titulo, rel: op.rel, texto: op.texto, truncado: op.truncado, mime: md ? 'text/markdown' : null }),
      App.nativo.hay && op.ruta ? h('button.btn', { onclick: function () { App.nativo.abrir(op.ruta); } }, App.icono('abrir'), 'Abrir con otra app') : null,
      h('button.btn.primario', { onclick: hj.cerrar }, 'Cerrar'));
    pintar();
    return hj;
  };
  function textoDe(c) {
    if (typeof c.texto === 'string') return c.texto;
    if (!c.base64) return null;
    try {
      var bin = atob(c.base64), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(arr);
    } catch (e) { return null; }
  }
  /* abre un archivo de la oficina (ruta relativa) con el visor que le toque: el mismo del chat para todo */
  App.abrirArchivoOficina = function (rel) {
    if (App.ChatRico) return App.ChatRico.abrirArchivo(rel);
    return App.api.get('/api/oficina/archivo', { ruta: rel }).then(App.abrirContenido).catch(App.fallo);
  };
  App.abrirMarkdownOficina = App.abrirArchivoOficina;

  /* abre un {nombre, mime, base64 | texto, ruta} devuelto por el backend, con el mismo visor que el chat:
     markdown formateado, imágenes en grande, HTML/SVG/mermaid dibujados y el resto del texto como código.
     Solo lo que la app no sabe mostrar (PDF, Word…) va a otra app o al navegador. */
  var EXT_TEXTO = /\.(txt|json|csv|tsv|log|xml|ya?ml|js|mjs|cjs|ts|tsx|jsx|css|py|sh|sql|toml|ini|env)$/i;
  var EXT_IMAGEN = /\.(png|jpe?g|gif|webp)$/i;
  var EXT_ARTEFACTO = { html: 'html', htm: 'html', svg: 'svg', mmd: 'mermaid', mermaid: 'mermaid' };
  App.abrirContenido = function (c) {
    var nombre = c.nombre || '', m = /\.([a-z0-9]+)$/i.exec(nombre), ext = m ? m[1].toLowerCase() : '';
    var CR = App.ChatRico;
    if (App.esMarkdown(nombre)) {
      var t = textoDe(c);
      if (t !== null) { App.verDocumento({ nombre: nombre, texto: t, ruta: c.ruta, rel: c.rel, truncado: c.truncado }); return; }
    }
    if (CR && EXT_IMAGEN.test(nombre) && c.base64) { CR.verImagen('data:' + (c.mime || 'image/' + ext) + ';base64,' + c.base64, nombre, c.rel); return; }
    if (CR && EXT_ARTEFACTO[ext]) {
      // una página de la oficina se vuelve a pedir por su ruta para dibujarla con su CSS, JS e imágenes
      var rel = !c.rel && EXT_ARTEFACTO[ext] === 'html' && c.ruta ? CR.relOficina(c.ruta) : null;
      if (rel) { CR.abrirArchivo(rel); return; }
      var cod = textoDe(c);
      if (cod !== null) { CR.verArtefacto({ tipo: EXT_ARTEFACTO[ext], codigo: cod, titulo: nombre, nombre: nombre, ruta: c.ruta, rel: c.rel }); return; }
    }
    if (typeof c.texto === 'string' || EXT_TEXTO.test(nombre)) {
      var tx = textoDe(c);
      if (tx !== null) { App.verDocumento({ nombre: nombre, texto: tx, ruta: c.ruta, rel: c.rel, truncado: c.truncado, markdown: false }); return; }
    }
    if (App.nativo.hay && c.ruta) { App.nativo.abrir(c.ruta); return; }
    // desde el navegador (puede ser otra compu): lo que la app no muestra se baja entero si está en la oficina
    if (!c.base64 && c.rel) { App.descargar({ nombre: nombre, rel: c.rel }); return; }
    if (!c.base64 && c.sinVista) { App.aviso('La app no sabe mostrar este tipo de archivo. Está en: ' + (c.ruta || ''), true); return; }
    if (!c.base64) { App.aviso('El archivo es muy grande para abrirlo desde el navegador. Está en: ' + (c.ruta || ''), true); return; }
    // El PDF se ve dentro del navegador; el resto se baja. window.open sobre un blob baja sin nombre (usa el UUID de la
    // URL, sin extensión), así que para bajar usamos un ancla con download, que conserva c.nombre.
    if (ext !== 'pdf') { App.bajarContenido(c); return; }
    var url = URL.createObjectURL(new Blob([bytesDe(c.base64)], { type: c.mime || 'application/pdf' }));
    if (!window.open(url, '_blank')) App.bajarContenido(c);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  };

  /* ---------- archivos para un agente («hacé algo con esta foto») ----------
     En el chat, al arrancar una corrida y en las tareas. Se eligen con el botón, se arrastran o se pegan; viajan en base64
     (`archivos: [{nombre, base64}]`) y el backend los guarda en archivos/adjuntos/ y le pasa las rutas al agente. */
  var ADJ_MAX = 10, ADJ_MB = 25, ADJ_ENCABEZADO = 'Archivos adjuntos (leelos con Read antes de responder):';
  var ADJ_IMAGEN = /\.(png|jpe?g|gif|webp|heic|bmp|svg)$/i;
  /* tipos que la Biblioteca sabe leer (TipoArchivo.soportados del backend) */
  var ADJ_BIBLIOTECA = /\.(pdf|docx?|rtf|pages|odt|txt|md|csv|tsv|json|png|jpe?g|gif|webp|heic)$/i;
  var ADJ_CLAVE_BIBLIOTECA = 'hq-adjuntos-biblioteca';
  App.Adjuntos = function (opc) {
    opc = opc || {};
    var archivos = [], urls = [];
    var err = opc.error || h('div.error-txt');
    var sel = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
    var lista = h('div.adjuntos');
    /* «Guardar también en la biblioteca»: se recuerda entre envíos; solo aparece si hay algún archivo que la Biblioteca lee */
    var aBiblioteca = false;
    try { aBiblioteca = localStorage.getItem(ADJ_CLAVE_BIBLIOTECA) === '1'; } catch (x) { /* sin almacenamiento: apagada */ }
    var casilla = h('input', { type: 'checkbox', checked: aBiblioteca, onchange: function () {
      aBiblioteca = casilla.checked;
      try { localStorage.setItem(ADJ_CLAVE_BIBLIOTECA, aBiblioteca ? '1' : '0'); } catch (x) { /* no se recuerda */ }
    } });
    var filaBiblioteca = h('label.adjuntos-biblioteca', { title: 'Además de pasárselos al agente, quedan en la Biblioteca (con su ficha) para que los consulte todo el equipo.' },
      casilla, App.icono('libro'), 'Guardar también en la biblioteca');
    var boton = h('button.btn' + (opc.texto ? '' : '.icono'), { type: 'button', title: 'Adjuntar archivos (también podés arrastrarlos o pegarlos)',
      onclick: function () { sel.click(); } }, App.icono('clip'), opc.texto || null);
    function total() { return archivos.reduce(function (n, f) { return n + f.size; }, 0); }
    function agregar(files) {
      err.textContent = '';
      Array.prototype.forEach.call(files || [], function (f) {
        if (archivos.length >= (opc.max || ADJ_MAX)) { err.textContent = 'Máximo ' + (opc.max || ADJ_MAX) + ' archivos por vez.'; return; }
        if (total() + f.size > ADJ_MB * 1048576) { err.textContent = 'Los archivos pueden pesar hasta ' + ADJ_MB + ' MB en total.'; return; }
        archivos.push(f);
      });
      pintar();
      if (opc.alCambiar) opc.alCambiar();
    }
    function pintar() {
      urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = [];
      App.vaciar(lista);
      archivos.forEach(function (f, i) {
        var mini = null;
        if (/^image\//.test(f.type)) { var u = URL.createObjectURL(f); urls.push(u); mini = h('img', { src: u, alt: '' }); }
        lista.appendChild(h('div.adjunto', { title: f.name + ' · ' + App.tam(f.size) }, mini || App.icono('clip'), h('span', f.name),
          h('button.btn.fantasma.chico.icono', { type: 'button', title: 'Sacar', onclick: function () { archivos.splice(i, 1); pintar(); if (opc.alCambiar) opc.alCambiar(); } }, App.icono('cerrar'))));
      });
      if (archivos.some(function (f) { return ADJ_BIBLIOTECA.test(f.name); })) lista.appendChild(filaBiblioteca);
      lista.style.display = archivos.length ? '' : 'none';
    }
    /* después de mandarlos: copia en la Biblioteca (compartido) los que sabe leer, uno por uno, y avisa cómo fue */
    function guardarEnBiblioteca(leidos) {
      if (!aBiblioteca || !leidos || !leidos.length) return Promise.resolve();
      var sirven = leidos.filter(function (a) { return ADJ_BIBLIOTECA.test(a.nombre); });
      var otros = leidos.length - sirven.length, ok = 0, ya = 0, reemplazados = [], fallas = [];
      return sirven.reduce(function (p, a) {
        return p.then(function () {
          return App.api.post('/api/archivos', { nombre: a.nombre, base64: a.base64 })
            .then(function (r) { if (r.duplicado) ya++; else if (r.reemplazado) reemplazados.push(a.nombre); else ok++; })
            .catch(function (e) { fallas.push(a.nombre + ': ' + e.message); });
        });
      }, Promise.resolve()).then(function () {
        var partes = [];
        if (ok) partes.push(ok === 1 ? 'Guardé 1 archivo en la biblioteca.' : 'Guardé ' + ok + ' archivos en la biblioteca.');
        if (ya) partes.push(ya === 1 ? '1 ya estaba.' : ya + ' ya estaban.');
        if (reemplazados.length) partes.push('Reemplacé en la biblioteca ' + reemplazados.join(', ') + ' (había otro con el mismo nombre).');
        if (otros) partes.push(otros === 1 ? '1 no es de un tipo que la biblioteca lea.' : otros + ' no son de un tipo que la biblioteca lea.');
        if (fallas.length) partes.push('No pude guardar ' + fallas.join(' · '));
        if (partes.length) App.aviso(partes.join(' '), fallas.length > 0);
      });
    }
    sel.addEventListener('change', function () { agregar(sel.files); sel.value = ''; });
    function leer(f) {
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { var s2 = String(fr.result || ''); res({ nombre: f.name || 'archivo', base64: s2.slice(s2.indexOf(',') + 1) }); };
        fr.onerror = function () { rej(new Error('No pude leer «' + f.name + '».')); };
        fr.readAsDataURL(f);
      });
    }
    /* arrastrar y soltar (y pegar, en un campo de texto) sobre `el` */
    function zona(el, campo) {
      el.addEventListener('dragover', function (e) {
        if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { e.preventDefault(); el.classList.add('soltando'); }
      });
      el.addEventListener('dragleave', function (e) { if (!el.contains(e.relatedTarget)) el.classList.remove('soltando'); });
      el.addEventListener('drop', function (e) {
        el.classList.remove('soltando');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); agregar(e.dataTransfer.files); }
      });
      if (campo) campo.addEventListener('paste', function (e) {
        var fs = e.clipboardData && e.clipboardData.files;
        if (fs && fs.length) {
          e.preventDefault();
          // una captura pegada llega como «image.png»: le ponemos fecha para que no se pisen los nombres
          agregar(Array.prototype.map.call(fs, function (f) {
            if (f.name && f.name !== 'image.png') return f;
            var n = 'captura-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png';
            try { return new File([f], n, { type: f.type }); } catch (x) { return f; }
          }));
        }
      });
    }
    pintar();
    return {
      boton: boton, lista: lista, input: sel, error: err, zona: zona, agregar: agregar,
      hay: function () { return archivos.length > 0; },
      nombres: function () { return archivos.map(function (f) { return f.name; }); },
      leer: function () { return Promise.all(archivos.map(leer)); },
      guardarEnBiblioteca: guardarEnBiblioteca,
      vaciar: function () { archivos = []; pintar(); }
    };
  };
  /* separa el bloque de adjuntos que el backend agrega al final de un mensaje: {texto, rutas} */
  App.Adjuntos.separar = function (t) {
    t = String(t || '');
    var i = t.indexOf(ADJ_ENCABEZADO);
    if (i < 0) return { texto: t, rutas: [] };
    var rutas = t.slice(i + ADJ_ENCABEZADO.length).split('\n').filter(function (l) { return /^- archivos\/adjuntos\//.test(l); })
      .map(function (l) { return l.slice(2).trim(); });
    return { texto: t.slice(0, i).replace(/\s+$/, ''), rutas: rutas };
  };
  /* chips de archivos ya guardados en la oficina (rutas relativas): miniatura si es imagen; clic para abrir */
  App.Adjuntos.chips = function (rutas, quitar) {
    return h('div.adjuntos', (rutas || []).map(function (r) {
      var nombre = r.split('/').pop(), mini = null;
      if (ADJ_IMAGEN.test(nombre)) {
        mini = h('img', { alt: '' });
        App.api.get('/api/oficina/archivo', { ruta: r }).then(function (c) { if (c.base64) mini.src = 'data:' + c.mime + ';base64,' + c.base64; }).catch(function () {});
      }
      return h('div.adjunto.guardado', { title: r, onclick: function () {
        App.api.get('/api/oficina/archivo', { ruta: r }).then(function (c) {
          App.abrirContenido({ nombre: nombre, mime: c.mime, base64: c.base64, ruta: c.ruta });
        }).catch(function () { App.aviso('No pude abrir ' + nombre + '. Está en la carpeta de la oficina: ' + r, true); });
      } }, mini || App.icono('clip'), h('span', nombre),
      quitar ? h('button.btn.fantasma.chico.icono', { type: 'button', title: 'Sacar de la tarea', onclick: function (e) { e.stopPropagation(); quitar(r); } }, App.icono('cerrar')) : null);
    }));
  };

  /* imagen de retrato con carga diferida */
  App.retratoImg = function (agente, clase, tam) {
    var img = h('img.' + (clase || 'retrato'), { alt: '' });
    App.Pixel.retrato(agente.avatar, agente.id, tam || 96).then(function (u) { img.src = u; }).catch(function () {});
    return img;
  };

  /* eventos simples */
  var subs = {};
  App.on = function (ev, fn) { (subs[ev] = subs[ev] || []).push(fn); };
  App.emit = function (ev, d) { (subs[ev] || []).slice().forEach(function (fn) { try { fn(d); } catch (e) { console.error(e); } }); };
})();
