/* La oficina en pixel art isométrico (App.Oficina: iniciar, construir, actividad, faros, reunion, pieza, muro,
   enfocar…); el resto de la app la maneja solo por esta interfaz.
   Usa N (pixel/nucleo.js), M (pixel/muebles.js), drawChar (pixel/personajes.js) y App.Pixel (pixel/avatar.js). */
window.App = window.App || {};
App.Oficina = (function () {
  'use strict';
  if (!window.N || !window.M || !window.drawChar) return null;
  var R = Math.round, S = N.S, WH = 46, WHI = 13, WT = .2, PROF = 6, PAS = 1.6, LAT = 1.4;
  var iso = N.iso, up = N.up, box = N.box, poly = N.poly, L = N.L, px = N.px, rect = N.rect, disc = N.disc, quad = N.quad, rng = N.rng, shade = N.shade;
  var reducido = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- estado del módulo ---------- */
  var cont = null, vista = null, vc = null, capa = null, mundo = null, g = null, W = 800, H = 600, FX = 20, FY = 14;
  var cbAgente = function () {}, cbLugar = function () {}, cbPasar = null;
  var salas = [], items = [], luces = [], EST = null, figs = {}, orden = [], puestos = {}, sillasReu = [], spotsOcio = [], recepcion = null, despacho = null, bandeja = null, recepcionYo = null, cafeYo = null, puestoBib = null;
  /* el bibliotecario de la memoria: vive detrás del mostrador de la Biblioteca; con la tablet en la mano mientras ordena
     la memoria y con un aviso encima si hay algo para decidir. El estado lo manda la Biblioteca (App.Biblioteca.vigilarEstado) */
  var BIB_ID = '__bibliotecario', bibDatos = { corriendo: false, pendientes: 0 };
  var BIB_AVATAR = { semilla: 'bibliotecario', pxPelo: 'rodete', colorPelo: '#9a9a9a', pxArriba: 'traje', colorTorso: '#5b4a3a' };
  var trabajo = {}, faroDe = {}, ocupados = {}, elegido = null, reunionActual = { ids: [], quien: null }, muroDatos = { entregas: [], sinRevisar: 0 };
  var piezas = [], etiquetas = [], etqSalas = [], etqBandeja = null, hover = null, pausado = false, oficinaNombre = '', deptoColor = {};
  var FASE = null, LUZ = 0, T = 0, ultimoTick = 0, ultimoRevisar = 0, ultimo = 0, raf = 0, dormido = 0, sucio = true;

  /* ---------- luz según la hora ---------- */
  var FASES = [
    { k: 'noche', desde: 0, tint: '#4a5185', glow: 1, sky: '#22305a', noche: true },
    { k: 'amanecer', desde: 5.5, tint: '#d6b2c6', glow: .5, sky: '#f4b8a8' },
    { k: 'manana', desde: 7.5, tint: '#fff4e4', glow: 0, sky: '#a6dcf0' },
    { k: 'mediodia', desde: 11, tint: null, glow: 0, sky: '#a6dcf0' },
    { k: 'tarde', desde: 16, tint: '#ffe4c0', glow: 0, sky: '#f6d49c' },
    { k: 'atardecer', desde: 18.5, tint: '#e9aa8c', glow: .45, sky: '#f0906a' },
    { k: 'anochecer', desde: 20, tint: '#7c74aa', glow: .8, sky: '#4a3f7a' },
    { k: 'noche', desde: 21, tint: '#4a5185', glow: 1, sky: '#22305a', noche: true }];
  function fase() { var d = new Date(), h = d.getHours() + d.getMinutes() / 60, f = FASES[0]; FASES.forEach(function (x) { if (h >= x.desde) f = x; }); return f; }

  /* ---------- colocación ---------- */
  var ALTO_MU = { biblioteca: 22, heladera: 26, expendedora: 26, arcade: 22, dispensador: 16, lamparaPie: 22, tvPie: 20, mostrador: 13, mesada: 11, archivero: 13, muebleBajo: 10,
    escritorio: 12, escritorioDoble: 18, escritorioL: 16, mesaReunion: 10, sillon2: 10, sillon1: 10, impresora: 14, sillaVisita: 10, banqueta: 7, mesaAlta: 11, pingpong: 9, mesaLectura: 10 };
  function hu(n, o) { return M.huellaDe ? M.huellaDe(n, o || {}) : ((M.huella && M.huella[n]) || { w: 1, d: 1 }); }
  function put(n, x, y, o) {
    o = o || {}; var h = hu(n, o), al = n === 'planta' ? ({ alta: 30, mediana: 20, chica: 10 }[o.tipo] || 20) : (ALTO_MU[n] || 10);
    // con funciones en las opciones (los monitores de un escritorio) depende del estado de los agentes: se dibuja siempre
    var vivo = Object.keys(o).some(function (k) { return typeof o[k] === 'function'; });
    if (n === 'lamparaPie') luces.push({ x: x + h.w / 2, y: y + h.d / 2, z: 20, r: 1.6 });
    items.push({ b: [x, y, x + h.w, y + h.d, al], d: x + h.w / 2 + y + h.d / 2, vivo: vivo, det: true, f: function (t) { if (M[n]) M[n](x, y, conT(t, o)); } });
    return h;
  }
  /* una función que recibe t es animada; sin parámetros es fija y se guarda como sprite */
  function at(d, f, b) { items.push({ d: d, f: f, b: b, vivo: f.length > 0 }); }
  function atDecor(d, f, b) { items.push({ d: d, f: f, b: b, det: true }); }
  /* opciones de un mueble con t de solo lectura: si el mueble la lee, es animado y no se guarda como sprite */
  var leyoT = false;
  function conT(t, o) { var r = Object.assign({ luz: LUZ }, o); Object.defineProperty(r, 't', { get: function () { leyoT = true; return t; }, enumerable: true, configurable: true }); return r; }
  var PARED = { t: '#f6efe3', l: '#e8dcc8', r: '#d4c6ae' }, MARCO = { t: '#a3815f', l: '#8f6f51', r: '#7a5d43' };
  var ANCHO = { pizarra: 1.4, corcho: 1, cuadro: .5, reloj: .5, tv: 1 };
  function tramos(u0, u1, huecos) {
    var cortes = [u0, u1]; huecos.forEach(function (h) { cortes.push(h[0], h[1]); }); for (var u = Math.ceil(u0 * 2) / 2; u < u1; u += .5) cortes.push(u);
    var cs = cortes.map(function (c) { return R(c * 1000) / 1000; }).filter(function (c, i, a) { return a.indexOf(c) === i && c >= u0 && c <= u1; }).sort(function (p, q) { return p - q; }), out = [];
    for (var i = 0; i + 1 < cs.length; i++) { var a = cs[i], b = cs[i + 1], m = (a + b) / 2; if (b - a < .005) continue; if (huecos.some(function (h) { return m > h[0] && m < h[1]; })) continue; out.push([a, b]); }
    return out;
  }
  function paredX(y, x0, x1, huecos, decor) {
    tramos(x0, x1, huecos).forEach(function (s) { at((s[0] + s[1]) / 2 + y + WT / 2, function () { box(s[0], y, s[1] - s[0], WT, 0, WHI, PARED); }, [s[0], y, s[1], y + WT, WHI]); });
    huecos.forEach(function (h) {
      at(h[0] + y + WT / 2, function () { box(h[0] - .04, y, .04, WT + .03, 0, WHI - 2, MARCO); }, [h[0] - .04, y, h[0], y + WT + .03, WHI]);
      at(h[1] + y + WT / 2, function () { box(h[1], y, .04, WT + .03, 0, WHI - 2, MARCO); }, [h[1], y, h[1] + .04, y + WT + .03, WHI]);
    });
    (decor || []).forEach(function (dc) { var fn = dc[0], u = dc[1], z = dc[2], o = dc[3] || {}, w = ANCHO[fn] || .6;
      atDecor(u + w + .3 + y + WT, function (t) { if (M.pared && M.pared[fn]) M.pared[fn]('x', u, y + WT, z, conT(t, o)); }, [u, y + WT, u + w, y + WT + .03, WHI]); });
  }
  function paredY(x, y0, y1, decor) {
    tramos(y0, y1, []).forEach(function (s) { at(x + WT / 2 + (s[0] + s[1]) / 2, function () { box(x, s[0], WT, s[1] - s[0], 0, WHI, PARED); }, [x, s[0], x + WT, s[1], WHI]); });
    (decor || []).forEach(function (dc) { var fn = dc[0], u = dc[1], z = dc[2], o = dc[3] || {}, w = ANCHO[fn] || .6;
      atDecor(x + WT + u + w + .3, function (t) { if (M.pared && M.pared[fn]) M.pared[fn]('y', u, x + WT, z, conT(t, o)); }, [x + WT, u, x + WT + .03, u + w, WHI]); });
  }

  /* ---------- planta: se arma con los departamentos y agentes de la oficina ---------- */
  function anchoDepto(n) { return Math.max(4.6, 2.5 + Math.ceil(Math.max(n, 1) / 2) * 1.75); }
  function planificar(oficina, perfil) {
    var deptos = (oficina.departamentos || []).slice(), ag = oficina.agentes || [];
    /* quien atiende la secretaría (departamento «recepcion», si la oficina no tiene uno con ese id) tiene su despacho
       al lado del tuyo; la recepción queda para el mostrador del Creador y las visitas */
    var enRecepcion = [];
    var porDepto = {}; ag.forEach(function (a) {
      var hay = a.departamento && deptos.some(function (d) { return d.id === a.departamento; });
      if (!hay && a.departamento === 'recepcion') { enRecepcion.push(a); return; }
      var k = hay ? a.departamento : '_sin'; (porDepto[k] = porDepto[k] || []).push(a);
    });
    if (porDepto._sin) deptos.push({ id: '_sin', nombre: 'Sin departamento', color: '#9a9a9a' });
    var juegos = { tipo: 'juegos', nombre: 'Juegos y café', w: 7.6, color: '#d9b86a' };
    var fijas = [
      { tipo: 'direccion', nombre: perfil && perfil.nombre ? 'Despacho de ' + perfil.nombre : 'Tu despacho', w: 4.6, color: '#8fae9a' }];
    if (enRecepcion.length) fijas.push({ tipo: 'secretaria', nombre: 'Secretaría', w: 4.2, color: '#b9a27a', agentes: enRecepcion });
    fijas.push(
      { tipo: 'reunion', nombre: 'Sala de reuniones', w: 6.6, color: '#9c88c0' },
      { tipo: 'biblioteca', nombre: 'Biblioteca', w: 4.6, color: '#b39b7e' });
    var anchoFijas = fijas.reduce(function (s, r) { return s + r.w; }, juegos.w), maxAncho = Math.max(anchoFijas, 22);
    var filas = [fijas], fila = [{ tipo: 'recepcion', nombre: (oficina.nombre || 'Oficina') + ' · Recepción', w: 4.2, color: null }], ancho = 4.2;
    deptos.forEach(function (d) {
      var n = (porDepto[d.id] || []).length, w = anchoDepto(n);
      if (ancho + w > maxAncho && fila.length) { filas.push(fila); fila = []; ancho = 0; }
      fila.push({ tipo: 'depto', depto: d, nombre: d.nombre, w: w, color: d.color, agentes: porDepto[d.id] || [] }); ancho += w;
    });
    filas.push(fila);
    var largoFila = function (f) { return f.reduce(function (s, r) { return s + r.w; }, 0); };
    /* no hay espacios comunes: Juegos y café va al final de la fila que más hueco deja y se estira hasta el borde
       (cuanto más ancha, más rincones para descansar). En las otras filas, lo que falta se reparte entre sus salas */
    var largos = filas.map(largoFila), tope = Math.max.apply(null, largos), fJuegos = 0;
    largos.forEach(function (l, i) { if (tope - l > tope - largos[fJuegos] + .01) fJuegos = i; });
    filas[fJuegos].push(juegos);
    var maxFila = Math.max.apply(null, filas.map(largoFila));
    filas.forEach(function (f, i) {
      var falta = maxFila - largoFila(f);
      if (i === fJuegos || falta <= 0) return;
      var total = largoFila(f); f.forEach(function (r) { r.w += falta * r.w / total; });
    });
    FX = LAT + maxFila;
    FY = filas.length * (PROF + PAS);
    salas = [];
    filas.forEach(function (f, i) {
      var y0 = i * (PROF + PAS), x = LAT;
      f.forEach(function (r) { r.r = [x, y0, x + r.w, y0 + PROF]; r.fila = i; r.puerta = { x: x + r.w - .8 }; r.pasilloY = y0 + PROF + PAS / 2; x += r.w; salas.push(r); });
      // la última sala de cada fila llega hasta el borde derecho
      var ult = f[f.length - 1]; ult.r[2] = FX; ult.w = FX - ult.r[0]; ult.puerta.x = FX - .8;
    });
  }

  /* ---------- muebles de cada sala ---------- */
  function amueblar(perfil) {
    items = []; luces = []; puestos = {}; sillasReu = []; spotsOcio = []; recepcion = null; despacho = null; bandeja = null; recepcionYo = null; cafeYo = null; puestoBib = null;
    var filas = {}; salas.forEach(function (s) { (filas[s.fila] = filas[s.fila] || []).push(s); });
    Object.keys(filas).forEach(function (k) {
      var f = filas[k], y0 = f[0].r[1], i = +k;
      // pared norte (la fila 0 apoya en la pared exterior) y pared sur con una puerta por sala
      if (i > 0) paredX(y0 - WT, 0, FX, [[0, LAT]]);
      var huecos = f.map(function (s) { return [s.puerta.x - .45, s.puerta.x + .45]; }); huecos.push([0, LAT]);
      paredX(y0 + PROF - WT, 0, FX, huecos);
      // paredes entre salas, y la del pasillo lateral
      paredY(LAT - WT, y0, y0 + PROF - WT, []);
      f.forEach(function (s, j) { if (j > 0) paredY(s.r[0] - WT, y0, y0 + PROF - WT, decorPared(s)); else if (s.tipo !== 'recepcion') decorPrimera(s); });
    });
    salas.forEach(function (s) { ({ direccion: salaDireccion, reunion: salaReunion, biblioteca: salaBiblioteca, juegos: salaJuegos, recepcion: salaRecepcion, secretaria: salaSecretaria, depto: salaDepto }[s.tipo])(s, perfil); });
    EST = null;
  }
  function decorPared(s) { var y0 = s.r[1]; return s.tipo === 'reunion' ? [['pizarra', y0 + 1.4, 3]] : s.tipo === 'depto' ? [['pizarra', y0 + 1.2, 3], ['cuadro', y0 + 3.8, 5, { color: s.color }]] : s.tipo === 'direccion' ? [['cuadro', y0 + 2.2, 5, { color: '#4a80c6' }]] : s.tipo === 'secretaria' ? [['cuadro', y0 + 2.6, 5, { color: '#c47a4a' }]] : []; }
  function decorPrimera(s) { }
  function silla(p, mira) { at(p.x + p.y + (mira === '+y' ? -.15 : .12), function () { M.sillaOficina(p.x - .2, p.y - .2, { mira: mira }); }, [p.x - .2, p.y - .2, p.x + .2, p.y + .2, 10]); }
  var EST_MON = { pensando: 'pensando', leyendo: 'herramienta', buscando: 'herramienta', consultando: 'herramienta', escribiendo: 'trabajando', trabajando: 'trabajando', armando: 'trabajando' };
  function estadoMonitor(id) { if (!id) return 'inactivo'; if (faroDe[id] === 'error') return 'error'; var t = trabajo[id]; return t ? (EST_MON[t.estado] || 'trabajando') : 'inactivo'; }
  function salaDepto(s) {
    var x0 = s.r[0], y0 = s.r[1], ag = s.agentes || [], n = Math.ceil(Math.max(ag.length, 1) / 2);
    for (var i = 0; i < n; i++) islaDoble(x0 + .9 + i * 1.75, y0 + 2.3, ag[i * 2], ag[i * 2 + 1], s);
    put('planta', x0 + .3, y0 + .35, { tipo: 'alta' });
    put('muebleBajo', x0 + .25, y0 + 4.3, { mira: '+x' });
    if (s.w > 6) put('planta', s.r[2] - 1.6, y0 + .35, { tipo: 'mediana' });
  }
  function islaDoble(x, y, a1, a2, s) {
    var h = hu('escritorioDoble', {}), cx = x + h.w / 2, taza = (R(x * 7)) % 3 === 0;
    // el escritorio llama a atras/adelante sin argumentos: la animación sale de T (el cuadro actual)
    // puestos cruzados (atrás a la derecha, adelante a la izquierda): en isométrico así los dos monitores quedan lado a
    // lado; en la misma mitad caían en la misma columna de pantalla y parecían un solo monitor alto
    put('escritorioDoble', x, y, {
      atras: function () { M.monitor(cx - .02, y + .3, { mira: '-y', estado: estadoMonitor(a1 && a1.id), t: T, luz: LUZ, seed: x * 3 }); M.tecladoMouse(cx + .05, y + .1, { mira: '-y' }); if (taza) M.taza(cx - .4, y + .2, { t: T }); },
      adelante: function () { M.monitor(cx - .52, y + h.d - .42, { mira: '+y', estado: estadoMonitor(a2 && a2.id), t: T, luz: LUZ, seed: x * 5 }); M.tecladoMouse(cx - .45, y + h.d - .24, { mira: '+y' }); if (!taza) M.papeles(cx + .15, y + h.d - .3, {}); }
    });
    var hueco = x + h.w + .32;   // el lado de atrás se alcanza por el pasillo entre islas, no cruzando el escritorio
    [[{ x: cx + .25, y: y - .38 }, '+y', a1], [{ x: cx - .25, y: y + h.d + .38 }, '-y', a2]].forEach(function (q) {
      var p = q[0], mira = q[1], a = q[2]; silla(p, mira);
      if (a) puestos[a.id] = { x: p.x, y: p.y, mira: mira, sala: s, aisle: mira === '+y' ? { x: hueco, y: p.y - .6 } : { x: p.x, y: p.y + .6 } };
    });
  }
  function salaReunion(s) {
    var x0 = s.r[0] + Math.max(0, (s.r[2] - s.r[0] - 6.6) / 2), y0 = s.r[1];   // si la sala se ensanchó, la mesa queda al centro
    put('mesaReunion', x0 + 1.2, y0 + 2.3, { w: 4.0, d: 1.3 });
    for (var i = 0; i < 5; i++) {
      var xs = x0 + 1.6 + i * .8, pn = { x: xs, y: y0 + 1.95 }, ps = { x: xs, y: y0 + 3.98 };
      silla(pn, '+y'); silla(ps, '-y');
      sillasReu.push({ x: pn.x, y: pn.y, mira: '+y', sala: s, aisle: { x: pn.x, y: pn.y - .55 } }, { x: ps.x, y: ps.y, mira: '-y', sala: s, aisle: { x: ps.x, y: ps.y + .55 } });
    }
    put('tvPie', x0 + 5.9, y0 + 2.4, { mira: '-x' }); put('planta', s.r[0] + .3, y0 + .35, { tipo: 'alta' });
    luces.push({ x: x0 + 2.2, y: y0 + 2.9, z: 20, r: 2.2 }, { x: x0 + 3.9, y: y0 + 2.9, z: 20, r: 2.2 });
    at(9999, function () { M.lamparaColgante(x0 + 2.2, y0 + 2.9, { zTecho: WH - 4, luz: LUZ }); M.lamparaColgante(x0 + 3.9, y0 + 2.9, { zTecho: WH - 4, luz: LUZ }); });
  }
  function salaDireccion(s, perfil) {
    var x0 = s.r[0], y0 = s.r[1];
    put('escritorio', x0 + 1.2, y0 + 2.4, { mira: '+y' });
    var p = { x: x0 + 1.75, y: y0 + 2.0 }; silla(p, '+y');
    despacho = { x: p.x, y: p.y, mira: '+y', sala: s, perfil: perfil, aisle: { x: x0 + 3.0, y: p.y } };   // entra y sale por detrás del escritorio, sin pisar las sillas de visita
    bandeja = { x: x0 + 1.95, y: y0 + 2.55, sala: s };
    luces.push({ x: x0 + 1.3, y: y0 + 2.8, z: 9, r: 1.3 });
    at(50, function (t) { M.notebook(x0 + 1.35, y0 + 2.5, { mira: '-y' }); dibujarBandeja(); M.lamparaEscritorio(x0 + 1.25, y0 + 2.75, { luz: LUZ }); }, [x0 + 1.2, y0 + 2.4, x0 + 2.3, y0 + 3.0, 16]);
    put('sillaVisita', x0 + 1.5, y0 + 3.4, { mira: '-y' }); put('sillaVisita', x0 + 2.2, y0 + 3.4, { mira: '-y' });
    put('planta', x0 + .3, y0 + .35, { tipo: 'alta' }); put('sillon1', x0 + .3, y0 + 4.6, { mira: '+x', color: '#7a5d8a' }); put('lamparaPie', x0 + .3, y0 + 3.9, {});
  }
  function salaBiblioteca(s) {
    var x0 = s.r[0], y0 = s.r[1];
    put('biblioteca', x0 + .3, y0 + .2, { mira: '+y' }); put('biblioteca', x0 + 1.4, y0 + .2, { mira: '+y' }); put('biblioteca', x0 + .25, y0 + 1.6, { mira: '+x' });
    // el puesto del bibliotecario: estantes al fondo y un mostrador que mira a la puerta; él queda detrás, al lado de los libros
    put('biblioteca', x0 + 2.5, y0 + .2, { mira: '+y' }); put('biblioteca', x0 + 3.5, y0 + .2, { mira: '+y' });
    put('mostrador', x0 + 2.65, y0 + 1.7, { mira: '+y' });
    puestoBib = { x: x0 + 3.4, y: y0 + 1.25, mira: '+y', sit: false, sala: s };
    put('mesaLectura', x0 + 1.4, y0 + 2.8, {}); put('sillaVisita', x0 + 1.6, y0 + 2.35, { mira: '+y' }); put('sillaVisita', x0 + 2.2, y0 + 2.35, { mira: '+y' });
    put('sillon1', x0 + .5, y0 + 4.5, { mira: '+x', color: '#a0644a' }); put('lamparaPie', x0 + .3, y0 + 4.0, {});
    spotsOcio.push({ x: x0 + 1.9, y: y0 + 2.35, mira: '+y', sit: true, sala: s });
  }
  function salaJuegos(s) {
    var x0 = s.r[0], y0 = s.r[1];
    put('mesada', x0 + .4, y0 + .15, { w: 2.6, mira: '+y' });
    at(40, function (t) { M.cafetera(x0 + .7, y0 + .25, { t: t }); }, [x0 + .7, y0 + .25, x0 + .92, y0 + .45, 18]);
    at(40.1, function (t) { M.microondas(x0 + 2.0, y0 + .25, { t: t }); }, [x0 + 2.0, y0 + .25, x0 + 2.42, y0 + .55, 16]);
    put('heladera', x0 + 3.15, y0 + .15, {}); put('expendedora', x0 + 3.9, y0 + .15, {}); put('arcade', x0 + 4.75, y0 + .2, { mira: '+y' });
    put('mesaAlta', x0 + .7, y0 + 1.9, {}); put('banqueta', x0 + .4, y0 + 1.7, {}); put('banqueta', x0 + 1.3, y0 + 2.4, {});
    put('mesaAlta', x0 + 2.4, y0 + 1.9, {}); put('banqueta', x0 + 2.1, y0 + 1.7, {}); put('banqueta', x0 + 3.0, y0 + 2.4, {});
    put('sillon2', x0 + .35, y0 + 3.2, { mira: '+x', color: '#5d7fb3' }); put('mesaRatona', x0 + 1.4, y0 + 3.6, {});
    put('pingpong', x0 + 2.8, y0 + 3.4, {}); put('puff', x0 + 4.9, y0 + 3.6, { color: '#9c88c0' }); put('puff', x0 + 5.3, y0 + 4.3, { color: '#4fb176' });
    put('planta', x0 + .3, y0 + 5.2, { tipo: 'mediana' });
    spotsOcio.push({ x: x0 + .75, y: y0 + 3.6, mira: '+x', sit: true, sofa: true, sala: s }, { x: x0 + .75, y: y0 + 4.1, mira: '+x', sit: true, sofa: true, sala: s },
      { x: x0 + 1.15, y: y0 + 1.6, mira: '+y', sit: false, sala: s }, { x: x0 + 2.9, y: y0 + 1.6, mira: '+y', sit: false, sala: s }, { x: x0 + 2.5, y: y0 + 3.85, mira: '+x', sit: false, sala: s },
      { x: x0 + 4.65, y: y0 + 3.85, mira: '-x', sit: false, sala: s }, { x: x0 + 1.8, y: y0 + 1.15, mira: '-y', sit: false, sala: s });
    cafeYo = { x: x0 + .85, y: y0 + .8, mira: '-y', sit: false, sala: s };   // vos, frente a la cafetera
    /* si la sala quedó más ancha (se estiró hasta el borde de su fila), suma rincones de 3.4 de ancho, alternando
       un living (sillón, mesa ratona, sillón chico y dos arcades contra la pared) y un bar (mesas altas, ping-pong
       y expendedora). Cada rincón trae sus lugares para descansar; la franja de abajo queda libre para caminar */
    for (var k = 0, lx = x0 + 6.0; lx + 3.4 <= s.r[2] - .4; k++, lx += 3.4) {
      if (k % 2 === 0) {
        put('arcade', lx + .4, y0 + .2, { mira: '+y' }); put('arcade', lx + 1.0, y0 + .2, { mira: '+y' }); put('planta', lx + 2.8, y0 + .35, { tipo: 'alta' });
        put('sillon2', lx + .3, y0 + 2.2, { mira: '+x', color: ['#7a9a6a', '#5d7fb3', '#a0644a'][(k / 2) % 3] }); put('mesaRatona', lx + 1.15, y0 + 2.6, {});
        put('sillon1', lx + 2.3, y0 + 2.5, { mira: '-x', color: '#c47a4a' }); put('puff', lx + 1.3, y0 + 3.6, { color: '#9c88c0' });
        spotsOcio.push({ x: lx + .7, y: y0 + 2.6, mira: '+x', sit: true, sofa: true, sala: s }, { x: lx + .7, y: y0 + 3.1, mira: '+x', sit: true, sofa: true, sala: s },
          { x: lx + 2.5, y: y0 + 2.8, mira: '-x', sit: true, sofa: true, sala: s }, { x: lx + .9, y: y0 + 1.0, mira: '-y', sit: false, sala: s });
      } else {
        put('expendedora', lx + .3, y0 + .15, {}); put('dispensador', lx + 1.3, y0 + .3, {});
        put('mesaAlta', lx + .3, y0 + 1.6, {}); put('banqueta', lx + .0, y0 + 1.4, {}); put('banqueta', lx + .9, y0 + 2.1, {});
        put('mesaAlta', lx + 2.0, y0 + 1.6, {}); put('banqueta', lx + 1.7, y0 + 1.4, {}); put('banqueta', lx + 2.6, y0 + 2.1, {});
        put('pingpong', lx + .9, y0 + 3.3, {});
        spotsOcio.push({ x: lx + .75, y: y0 + 1.3, mira: '+y', sit: false, sala: s }, { x: lx + 2.45, y: y0 + 1.3, mira: '+y', sit: false, sala: s },
          { x: lx + .6, y: y0 + 3.75, mira: '+x', sit: false, sala: s }, { x: lx + 2.75, y: y0 + 3.75, mira: '-x', sit: false, sala: s });
      }
    }
    if (s.r[2] - x0 > 8.6) put('planta', s.r[2] - .7, y0 + .35, { tipo: 'mediana' });
  }
  function salaRecepcion(s) {
    var x0 = s.r[0], y0 = s.r[1];
    put('mostrador', x0 + 1.0, y0 + 2.0, { mira: '+y' }); put('dispensador', x0 + 3.2, y0 + .3, {}); put('planta', x0 + .3, y0 + .35, { tipo: 'alta' });
    put('sillaVisita', x0 + .35, y0 + 3.9, { mira: '+x' }); put('sillaVisita', x0 + .35, y0 + 4.6, { mira: '+x' }); put('planta', x0 + 2.5, y0 + 5.0, { tipo: 'mediana' });
    recepcion = { x: x0 + 1.8, y: y0 + 2.9, sala: s };
    recepcionYo = { x: x0 + 2.6, y: y0 + 3.3, mira: '-x', sit: false, sala: s };   // vos, recibiendo al lado del mostrador
  }
  /* el despacho de quien atiende la secretaría, pegado al tuyo: escritorio con monitor (uno por persona, hasta dos),
     archiveros contra la pared y dos sillas para las visitas */
  function salaSecretaria(s) {
    var x0 = s.r[0], y0 = s.r[1], ag = (s.agentes || []).slice(0, 2), n = Math.max(ag.length, 1);
    for (var i = 0; i < n; i++) escritorioSecretaria(x0 + (n === 1 ? 1.4 : .7 + i * 1.6), y0 + 2.3, ag[i], s);
    put('archivero', x0 + .3, y0 + .2, { mira: '+y' }); put('archivero', x0 + .78, y0 + .2, { mira: '+y' });
    put('planta', s.r[2] - .9, y0 + .35, { tipo: 'alta' });
    put('sillaVisita', x0 + 1.5, y0 + 3.4, { mira: '-y' }); put('sillaVisita', x0 + 2.2, y0 + 3.4, { mira: '-y' });
    put('muebleBajo', x0 + .25, y0 + 4.3, { mira: '+x' });
  }
  function escritorioSecretaria(x, y, a, s) {
    put('escritorio', x, y, { mira: '+y', mat: 'blanco' });
    at(50, function () { M.monitor(x + .45, y + .32, { mira: '-y', estado: estadoMonitor(a && a.id), t: T, luz: LUZ, seed: x * 3 }); M.tecladoMouse(x + .5, y + .12, { mira: '-y' }); M.papeles(x + .1, y + .2, {}); }, [x, y, x + 1.1, y + .6, 16]);
    var p = { x: x + .55, y: y - .4 }; silla(p, '+y');
    if (a) puestos[a.id] = { x: p.x, y: p.y, mira: '+y', sala: s, aisle: { x: x + 1.4, y: p.y } };
  }
  /* bandeja de entregas sobre tu escritorio: hojas del color del departamento de quien la hizo */
  function dibujarBandeja() {
    if (!bandeja) return;
    var b = bandeja, z = 8, hojas = (muroDatos.entregas || []).slice(0, 8);
    box(b.x, b.y, .32, .24, z, .6, { t: '#4a4d55', l: '#3a3d45', r: '#2c2e35', o: N.OUT });
    hojas.forEach(function (e, i) { var c = e.origen === 'reunion' ? '#0a5fb4' : (deptoColor[deptoDe(e.agente)] || '#6b7078');
      box(b.x + .03, b.y + .03, .26, .18, z + .6 + i * .35, .3, { t: i === hojas.length - 1 ? '#ffffff' : '#f2efe8', l: c, r: shade(c, .8) }); });
  }
  function deptoDe(id) { var f = figs[id]; return f && f.a ? f.a.departamento : null; }

  /* ---------- piso, paredes exteriores y ventanales ---------- */
  var MADERA = ['#d3a571', '#c4945f', '#ad7f4f', '#946a40'], BALDOSA = ['#d6d0c6', '#c8c1b5'];
  function pisoMadera(x0, y0, x1, y1) {
    quad(x0, y0, x1, y1, MADERA[1]);
    for (var y = y0; y <= y1 + .001; y += 1 / 3) L(iso(x0, y), iso(x1, y), MADERA[2]);
    var r = rng(R(x0 * 31 + y0 * 7)), j = 0;
    for (y = y0; y < y1 - .01; y += 1 / 3, j++) { for (var x = x0 + (j % 3) * .7; x < x1; x += 2.1) L(iso(x, y), iso(x, Math.min(y + 1 / 3, y1)), MADERA[3]);
      for (var k = 0; k < (x1 - x0) * 1.5; k++) { var p = iso(x0 + r() * (x1 - x0), y + r() / 3); px(p[0], p[1], r() < .5 ? MADERA[0] : MADERA[2]); } }
  }
  function pisoBaldosa(x0, y0, x1, y1) {
    quad(x0, y0, x1, y1, BALDOSA[0]);
    for (var x = Math.ceil(x0 * 2) / 2; x < x1; x += .5) L(iso(x, y0), iso(x, y1), BALDOSA[1]);
    for (var y = Math.ceil(y0 * 2) / 2; y < y1; y += .5) L(iso(x0, y), iso(x1, y), BALDOSA[1]);
  }
  function ventanal(Pf, u0, u1, s) {
    var F = FASE || FASES[3], r = rng(s * 37), MC = '#535a68';
    poly([Pf(u0, 9), Pf(u1, 9), Pf(u1, 41), Pf(u0, 41)], MC); poly([Pf(u0 + .05, 10), Pf(u1 - .05, 10), Pf(u1 - .05, 40), Pf(u0 + .05, 40)], F.sky);
    var BC = { noche: ['#1a2140', '#232b4e'], anochecer: ['#3a3466', '#463e72'], atardecer: ['#a06c78', '#b07e84'], amanecer: ['#b99bad', '#c6aab8'], tarde: ['#a9b2c2', '#98a3b6'] }[F.k] || ['#9db1ca', '#8aa0bd'];
    var lit = F.noche || F.k === 'anochecer' || F.k === 'atardecer', c, k;
    if (!lit) { for (k = 0; k < 2; k++) { c = Pf(u0 + .4 + r() * (u1 - u0 - .8), 33 + r() * 4); rect(c[0] - 4, c[1], 10, 1, '#ffffff'); rect(c[0] - 2, c[1] - 1, 5, 1, '#ffffff'); } }
    else if (F.noche) { for (k = 0; k < 8; k++) { c = Pf(u0 + .1 + r() * (u1 - u0 - .2), 30 + r() * 9); px(c[0], c[1], '#fff6c8'); } }
    for (var u = u0 + .05; u < u1 - .06;) {
      var w = .16 + r() * .3, h = 7 + r() * 18, ue = Math.min(u + w, u1 - .05), col = BC[(r() * 2) | 0];
      poly([Pf(u, 10), Pf(ue, 10), Pf(ue, 10 + h), Pf(u, 10 + h)], col);
      for (var z = 13; z < 8 + h; z += 3) for (var q = u + .04; q < ue - .03; q += .08) if (r() < (lit ? .35 : .18)) { c = Pf(q, z); px(c[0], c[1], lit ? '#ffd77a' : shade(col, 1.18)); }
      u = ue + .015;
    }
    var TC = { noche: '#22382c', anochecer: '#33424a', atardecer: '#5e6a48', amanecer: '#7a8a6a' }[F.k] || '#6f9e64';
    for (u = u0 + .12; u < u1 - .1; u += .15) { c = Pf(u, 11 + r() * 2); disc(c[0], c[1], 2 + ((r() * 2) | 0), TC); }
    for (u = u0 + 1.25; u < u1 - .3; u += 1.25) L(Pf(u, 9), Pf(u, 41), MC); L(Pf(u0, 29), Pf(u1, 29), MC); L(Pf(u0, 9), Pf(u1, 9), '#ece6db');
  }
  function dibujarPiso() {
    g.clearRect(0, 0, W, H);
    salas.forEach(function (s) { (s.tipo === 'recepcion' ? pisoBaldosa : pisoMadera).apply(null, s.r); });
    pisoBaldosa(0, 0, LAT, FY);
    salas.filter(function (s) { return s.fila === 0 || true; }).forEach(function (s) { pisoBaldosa(0, s.r[3], FX, s.r[3] + PAS); });
    salas.forEach(function (s) { if (!s.color || s.tipo === 'recepcion') return; var r = s.r, m = .7; if (M.alfombra) M.alfombra(r[0] + m, r[1] + m, r[2] - m, r[3] - m, { color: s.color }); });
    var b0 = iso(0, FY), b1 = iso(FX, FY), b2 = iso(FX, 0);
    poly([b0, b1, [b1[0], b1[1] + 6], [b0[0], b0[1] + 6]], '#8a6a4a'); poly([b2, b1, [b1[0], b1[1] + 6], [b2[0], b2[1] + 6]], '#6f5238');
    var WALL = '#ece3d3', WALL_L = '#ddd2bf', CAP = '#f7f1e6';
    poly([iso(0, 0), iso(FX, 0), up(iso(FX, 0), WH), up(iso(0, 0), WH)], WALL);
    poly([iso(0, 0), iso(0, FY), up(iso(0, FY), WH), up(iso(0, 0), WH)], WALL_L);
    poly([iso(0, 0), iso(FX, 0), up(iso(FX, 0), 4), up(iso(0, 0), 4)], '#8a7357'); poly([iso(0, 0), iso(0, FY), up(iso(0, FY), 4), up(iso(0, 0), 4)], '#6f5b44');
    var PB = function (u, z) { return up(iso(u, 0), z); }, PL = function (u, z) { return up(iso(0, u), z); }, sd = 1;
    salas.filter(function (s) { return s.fila === 0; }).forEach(function (s) { ventanal(PB, s.r[0] + .4, s.r[2] - .4, sd++); });
    for (var y = .4; y < FY - 1; y += PROF + PAS) ventanal(PL, y, Math.min(y + PROF - .8, FY - .4), sd++);
    poly([up(iso(0, 0), WH - 2), up(iso(FX, 0), WH - 2), up(iso(FX, 0), WH), up(iso(0, 0), WH)], CAP); poly([up(iso(0, 0), WH - 2), up(iso(0, FY), WH - 2), up(iso(0, FY), WH), up(iso(0, 0), WH)], CAP);
    if (!FASE || !FASE.noche) N.alpha(.1, function () { salas.filter(function (s) { return s.fila === 0; }).forEach(function (s) { for (var u = s.r[0] + .4; u < s.r[2] - 1; u += 1.6) poly([PB(u + .1, 12), PB(u + 1.2, 12), iso(u + 2.4, 3.2), iso(u + .9, 3.2)], '#fff3d0'); }); });
  }
  var pisos = {};
  function pisoPara(k) { if (pisos[k]) return pisos[k]; var cv = document.createElement('canvas'); cv.width = W; cv.height = H; dibujarPiso(); cv.getContext('2d').drawImage(mundo, 0, 0); pisos[k] = cv; return cv; }

  /* ---------- figuras: agentes y vos ---------- */
  function figura(a, home, esYo) {
    var f = figs[a.id] || { a: a, x: home.x, y: home.y, mira: home.mira, sit: true, modo: 'puesto', ruta: null, k: 0, ocioDesde: 0, destYo: 'puesto' };
    f.a = a; f.home = home; f.yo = !!esYo; f.c = App.Pixel ? App.Pixel.spec(a.avatar, a.id) : null;
    if (f.modo === 'puesto' && !f.ruta) { f.x = home.x; f.y = home.y; f.mira = home.mira; f.sit = home.sit !== false; }
    f.bib = a.id === BIB_ID;
    figs[a.id] = f; return f;
  }
  function bloqueado(id) { return trabajo[id] || ocupados[id] || elegido === id || faroDe[id] || reunionActual.ids.indexOf(id) >= 0; }
  var ESTADO_POSE = { pensando: 'pensar' };
  function poseDe(f) {
    if (f.ruta) return 'caminar';
    if (!f.sit) return f.bib && bibDatos.corriendo ? 'tablet' : f.hablar ? 'hablar' : 'quieto';
    var id = f.a.id;
    if (faroDe[id] === 'error' && f.modo === 'puesto') return 'error';
    var t = trabajo[id]; if (t && f.modo === 'puesto') return ESTADO_POSE[t.estado] || 'tipear';
    if (f.modo === 'ocio' && f.spot && f.spot.sofa) return 'dormir';
    return 'quieto';
  }
  function orient(m) { return { '+x': ['se', false], '+y': ['se', true], '-y': ['ne', false], '-x': ['ne', true] }[m] || ['se', false]; }
  function dibujarFigura(f, t) {
    var p = iso(f.x, f.y); f.sx = R(p[0]); f.sy = R(p[1]);
    var st = poseDe(f), sit = f.sit && !f.ruta;
    if ((f.mira === '-y' || f.mira === '-x') && st === 'pensar') st = 'tipear';
    var o = orient(f.mira);
    if (!sit) { g.fillStyle = 'rgba(40,25,30,.28)'; for (var y = -1; y <= 1; y++) { var w = y === 0 ? 8 : 6; g.fillRect(f.sx - w, f.sy + y, w * 2, 1); } }
    var seat = f.spot && f.spot.sofa ? 3.5 * S : 4 * S, sh = st === 'error' && (t % 16) < 6 ? (t % 2 ? 1 : -1) : 0, ay = sit ? f.sy - R(seat) : f.sy;
    if (f.c) drawChar(g, f.sx + sh, ay, f.c, o[0], sit, o[1], t + (f.semilla || 0), st);
    f.top = sit ? ay - (drawChar.ALTO_SENTADO || 26) : ay - (drawChar.ALTO || 43);
    if (elegido === f.a.id || hover && (hover.tipo === 'agente' && hover.id === f.a.id || f.bib && hover.id === 'bibliotecario')) {
      var c = elegido === f.a.id ? '#ffcf5a' : '#ffffff', sx = f.sx, sy0 = f.sy;
      L([sx - 15, sy0], [sx, sy0 - 7], c); L([sx, sy0 - 7], [sx + 15, sy0], c); L([sx + 15, sy0], [sx, sy0 + 7], c); L([sx, sy0 + 7], [sx - 15, sy0], c);
    }
  }

  /* ---------- caminatas ---------- */
  var VEL = 1.6;
  function salida(s) { return { x: s.puerta.x, yIn: s.r[3] - .7, yOut: s.pasilloY }; }
  function ruta(desde, hacia) {
    // desde/hacia: {x, y, sala, aisle?}
    var pts = [], a = salida(desde.sala), b = salida(hacia.sala);
    if (desde.aisle) pts.push(desde.aisle);
    var ay = desde.aisle ? desde.aisle.y : desde.y;
    if (desde.sala === hacia.sala) { if (hacia.aisle) pts.push({ x: hacia.aisle.x, y: ay }, hacia.aisle); pts.push({ x: hacia.x, y: hacia.y }); return pts; }
    pts.push({ x: a.x, y: ay }, { x: a.x, y: a.yIn }, { x: a.x, y: a.yOut });
    if (desde.sala.fila !== hacia.sala.fila) pts.push({ x: LAT / 2, y: a.yOut }, { x: LAT / 2, y: b.yOut });
    pts.push({ x: b.x, y: b.yOut }, { x: b.x, y: b.yIn });
    var hy = hacia.aisle ? hacia.aisle.y : hacia.y;
    pts.push({ x: hacia.aisle ? hacia.aisle.x : hacia.x, y: b.yIn }, { x: hacia.aisle ? hacia.aisle.x : hacia.x, y: hy });
    pts.push({ x: hacia.x, y: hacia.y });
    return pts;
  }
  function ubicacion(f) { return f.modo === 'puesto' ? f.home : f.spot; }
  function irA(f, destino, modo) {
    var origen = ubicacion(f) || f.home;
    if (!origen || !destino || !origen.sala || !destino.sala) return;
    f.ruta = reducido ? null : ruta(origen, destino); f.k = 0; f.sit = false; f.modo = modo; f.spot = destino;
    if (reducido) { f.x = destino.x; f.y = destino.y; f.mira = destino.mira; f.sit = destino.sit !== false; }
  }
  function avanzar(f, dt) {
    if (!f.ruta) return;
    var paso = VEL * dt;
    while (paso > 0 && f.k < f.ruta.length) {
      var q = f.ruta[f.k], dx = q.x - f.x, dy = q.y - f.y, dist = Math.hypot(dx, dy);
      if (dist < 1e-3) { f.k++; continue; }
      f.mira = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? '+x' : '-x') : (dy > 0 ? '+y' : '-y');
      var m = Math.min(paso, dist); f.x += dx / dist * m; f.y += dy / dist * m; paso -= m;
    }
    if (f.k >= f.ruta.length) { f.ruta = null; var d = f.spot || f.home; f.x = d.x; f.y = d.y; f.mira = d.mira; f.sit = d.sit !== false; }
    sucio = true;
  }
  /* quién va a la reunión, quién vuelve, quién se va a descansar */
  function revisar(now) {
    var ids = reunionActual.ids || [];
    Object.keys(figs).forEach(function (id) {
      var f = figs[id]; if (f.bib) return; if (f.yo) { revisarYo(f, now); return; }
      var i = ids.indexOf(id);
      if (i >= 0 && i < sillasReu.length) { if (f.modo !== 'reunion' || f.spot !== sillasReu[i]) irA(f, Object.assign({ sit: true }, sillasReu[i]), 'reunion'); f.hablar = reunionActual.quien === id; return; }
      f.hablar = false;
      if (f.modo === 'reunion') { irA(f, Object.assign({ sit: true }, f.home), 'puesto'); return; }
      if (f.modo === 'ocio' && bloqueado(id)) { irA(f, Object.assign({ sit: true }, f.home), 'puesto'); return; }
      /* quien atiende la secretaría no se va a pasear: se queda en su escritorio */
      var enMostrador = f.home && f.home.sala && f.home.sala.tipo === 'secretaria';
      if (f.modo === 'puesto' && !f.ruta && !bloqueado(id) && spotsOcio.length && !reducido && !enMostrador) {
        if (!f.ocioDesde) f.ocioDesde = now + 15000 + (hashStr(id) % 30000);
        else if (now > f.ocioDesde) { var libre = spotsOcio.filter(function (s) { return !Object.keys(figs).some(function (k) { return figs[k].spot === s && figs[k].modo === 'ocio'; }); });
          if (libre.length) irA(f, libre[hashStr(id) % libre.length], 'ocio'); f.ocioDesde = 0; }
      } else if (f.modo === 'puesto') f.ocioDesde = 0;
    });
  }
  /* vos: en el despacho, salvo que estés con un agente abierto (visita), armando con el Creador (recepción)
     o un rato sin tocar nada con la oficina a la vista (café). Las piezas y la bandeja siguen yendo al despacho */
  var VISITA_MS = 3000, CAFE_MS = 5 * 60000, elegidoDesde = 0, ultimaActividad = performance.now();
  function visitaDe(f) {
    var h = f.home; if (!h || !h.aisle) return null;
    var norte = h.mira === '+y', x = h.x + (norte ? .6 : -.6), y = h.y + (norte ? -.15 : .15);
    return { x: x, y: y, mira: norte ? '-x' : '+x', sit: false, sala: h.sala, aisle: { x: norte ? h.aisle.x : x, y: h.aisle.y } };
  }
  function creadorAbierto() { try { return !!(App.Creador && App.Creador.abierta && App.Creador.abierta()); } catch (e) { return false; } }
  function destinoYo(now) {
    if (recepcionYo && creadorAbierto()) return { clave: 'recepcion', modo: 'recepcion', spot: recepcionYo };
    var a = elegido && figs[elegido];
    if (a && !a.yo && a.modo !== 'reunion' && now - elegidoDesde >= VISITA_MS) { var v = visitaDe(a); if (v) return { clave: 'visita:' + elegido, modo: 'visita', spot: v }; }
    if (cafeYo && now - ultimaActividad >= CAFE_MS) return { clave: 'cafe', modo: 'cafe', spot: cafeYo };
    return null;
  }
  function revisarYo(f, now) {
    if (f.ruta) return;   // termina de llegar y recién ahí cambia de rumbo (si no, cruza paredes en diagonal)
    var d = destinoYo(now), clave = d ? d.clave : 'puesto';
    if (clave === f.destYo) return;
    f.destYo = clave; f.hablar = !!d && d.modo === 'visita';
    if (d) irA(f, d.spot, d.modo); else irA(f, Object.assign({ sit: true }, f.home), 'puesto');
  }
  function hashStr(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

  /* ---------- pieza viajera de los flujos ---------- */
  function lugarDe(id) { if (!id) return recepcion ? { x: recepcion.x, y: recepcion.y, sala: recepcion.sala } : null; var f = figs[id]; var u = f && (f.yo ? f.home : (ubicacion(f) || f.home)); return u ? { x: u.x, y: u.y, sala: u.sala, aisle: u.aisle } : null; }
  function pieza(desde, hacia, color) {
    try {
      if (desde === hacia) return false;
      var a = lugarDe(desde), b = lugarDe(hacia); if (!a || !b) return false;
      var pts = [{ x: a.x, y: a.y }].concat(ruta(a, b));
      var largo = 0; for (var i = 1; i < pts.length; i++) largo += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      piezas.push({ pts: pts, largo: largo, t0: performance.now(), dur: Math.max(1500, Math.min(3000, largo * 260)), color: color || (deptoColor[deptoDe(hacia)] || '#f2b84b') });
      pedir(); return true;
    } catch (e) { return false; }
  }
  function dibujarPiezas(now) {
    piezas = piezas.filter(function (p) { return now - p.t0 < p.dur + 400; });
    piezas.forEach(function (p) {
      var u = Math.min(1, (now - p.t0) / p.dur), d = u * p.largo, i = 1, x = p.pts[0].x, y = p.pts[0].y;
      for (; i < p.pts.length; i++) { var a = p.pts[i - 1], b = p.pts[i], l = Math.hypot(b.x - a.x, b.y - a.y); if (d <= l) { x = a.x + (b.x - a.x) * d / (l || 1); y = a.y + (b.y - a.y) * d / (l || 1); break; } d -= l; x = b.x; y = b.y; }
      var al = now - p.t0 > p.dur ? 1 - (now - p.t0 - p.dur) / 400 : 1, z = 14 + Math.sin(now / 120) * 1.5;
      N.alpha(.3 * al, function () { var s = iso(x, y); g.fillStyle = '#000'; g.fillRect(R(s[0]) - 4, R(s[1]) - 1, 8, 2); });
      N.alpha(al, function () { box(x - .12, y - .12, .24, .24, z, 2.4, N.tonos(p.color, N.OUT)); });
    });
    if (piezas.length) sucio = true;
  }

  /* ---------- orden de dibujo isométrico ---------- */
  function caja(it) { var b = it.b, l = iso(b[0], b[3])[0], r = iso(b[2], b[1])[0], tp = iso(b[0], b[1])[1] - b[4] * S - 6, bt = iso(b[2], b[3])[1] + 2; return [l, tp, r, bt]; }
  function solapa(p, q) { return p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3]; }
  function atras(A, B) { return A[2] <= B[0] + 1e-6 || A[3] <= B[1] + 1e-6; }
  function antes(A, B) { var ab = atras(A.b, B.b), ba = atras(B.b, A.b); if (ab && !ba) return true; if (ba && !ab) return false;
    if (!ab && !ba && !!A.enSofa !== !!B.enSofa) return !!B.enSofa;   // quien está sentado en un sillón queda dentro de su caja: se dibuja encima de él
    return A.d < B.d; }
  function prepararEstaticos() {
    var Ls = items.filter(function (i) { return i.b; });
    Ls.forEach(function (i) { i.sb = caja(i); i.sal = []; i.ent0 = 0; });
    for (var i = 0; i < Ls.length; i++) for (var j = i + 1; j < Ls.length; j++) { var A = Ls[i], B = Ls[j]; if (!solapa(A.sb, B.sb)) continue; if (antes(A, B)) { A.sal.push(j); B.ent0++; } else { B.sal.push(i); A.ent0++; } }
    EST = { L: Ls, sinCaja: items.filter(function (i) { return !i.b; }).sort(function (p, q) { return p.d - q.d; }) };
  }
  function ordenar() {
    if (!EST) prepararEstaticos();
    var Ls = EST.L, n0 = Ls.length;
    var ags = Object.keys(figs).map(function (id) { var f = figs[id]; return { b: [f.x - .07, f.y - .07, f.x + .07, f.y + .07, 18], d: f.x + f.y, enSofa: !!(f.sit && !f.ruta && f.spot && f.spot.sofa), f: function (t) { dibujarFigura(f, t); } }; });
    var todos = Ls.concat(ags), n = todos.length, ent = new Int32Array(n), extra = [];
    for (var i = 0; i < n; i++) { extra.push([]); if (i < n0) ent[i] = Ls[i].ent0; }
    ags.forEach(function (A, ai) { var ia = n0 + ai; A.sb = caja(A);
      for (var j = 0; j < n; j++) { if (j === ia) continue; var B = todos[j]; if (j > ia || j < n0) { if (!solapa(A.sb, B.sb || caja(B))) continue; if (antes(A, B)) { extra[ia].push(j); ent[j]++; } else { extra[j].push(ia); ent[ia]++; } } } });
    var heap = [], hecho = new Uint8Array(n), out = [];
    function push(i) { heap.push(i); var c = heap.length - 1; while (c > 0) { var p = (c - 1) >> 1; if (todos[heap[p]].d <= todos[heap[c]].d) break; var t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p; } }
    function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var c = 0; for (;;) { var l = 2 * c + 1, r = l + 1, m = c; if (l < heap.length && todos[heap[l]].d < todos[heap[m]].d) m = l; if (r < heap.length && todos[heap[r]].d < todos[heap[m]].d) m = r; if (m === c) break; var t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m; } } return top; }
    for (i = 0; i < n; i++) if (!ent[i]) push(i);
    while (out.length < n) {
      var k; if (heap.length) k = pop(); else { var mm = -1; for (var q = 0; q < n; q++) if (!hecho[q] && (mm < 0 || todos[q].d < todos[mm].d)) mm = q; k = mm; }
      if (hecho[k]) continue; hecho[k] = 1; out.push(todos[k]);
      var sal = k < n0 ? Ls[k].sal.concat(extra[k]) : extra[k];
      for (var s = 0; s < sal.length; s++) { var jj = sal[s]; if (!hecho[jj] && --ent[jj] === 0) push(jj); }
    }
    return out.concat(EST.sinCaja);
  }

  /* ---------- render ---------- */
  function render(now) {
    FASE = fase(); LUZ = FASE.glow;
    N.g = g; g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, W, H);
    g.drawImage(pisoPara(FASE.k), 0, 0);
    ordenar().forEach(dibujarItem);
    dibujarPiezas(now);
    var F = FASE;
    if (F.tint) { g.globalCompositeOperation = 'multiply'; if (F.glow > 0) g.drawImage(luzPara(F), 0, 0); else { g.fillStyle = F.tint; g.fillRect(0, 0, W, H); } g.globalCompositeOperation = 'destination-in'; g.drawImage(pisoPara(F.k), 0, 0); g.globalCompositeOperation = 'source-over'; }
  }
  /* ---------- sprites de los muebles fijos ----------
     Cada mueble se pinta con miles de fillRect de 1 px. Los que no se animan se graban una vez por fase del día
     (la luz cambia con la fase) en un canvas chico y después solo se copian; los animados se dibujan como siempre. */
  function grabador() {
    var ops = [], b = [Infinity, Infinity, -Infinity, -Infinity];
    return { fillStyle: '#000', globalAlpha: 1, ops: ops, b: b,
      fillRect: function (x, y, w, h) { ops.push(x, y, w, h, this.fillStyle, this.globalAlpha);
        b[0] = Math.min(b[0], x, x + w); b[1] = Math.min(b[1], y, y + h); b[2] = Math.max(b[2], x, x + w); b[3] = Math.max(b[3], y, y + h); } };
  }
  function volcar(rec, ctx, ox, oy) {
    var o = rec.ops;
    for (var i = 0; i < o.length; i += 6) { ctx.fillStyle = o[i + 4]; ctx.globalAlpha = o[i + 5]; ctx.fillRect(o[i] - ox, o[i + 1] - oy, o[i + 2], o[i + 3]); }
    ctx.globalAlpha = 1;
  }
  function dibujarItem(it) {
    if (it.vivo) { it.f(T); return; }
    var s = it.spr;
    if (s && s.k === FASE.k) { if (s.cv) g.drawImage(s.cv, s.x, s.y); return; }
    var rec = grabador(), g0 = N.g; leyoT = false; N.g = rec;
    try { it.f(T); } catch (e) { N.g = g0; it.vivo = true; it.f(T); return; }
    N.g = g0;
    if (it.det && leyoT) { it.vivo = true; volcar(rec, g, 0, 0); return; }
    var b = rec.b, x0 = Math.floor(b[0]), y0 = Math.floor(b[1]), cv = null;
    if (rec.ops.length) { cv = document.createElement('canvas'); cv.width = Math.max(1, Math.ceil(b[2]) - x0); cv.height = Math.max(1, Math.ceil(b[3]) - y0); volcar(rec, cv.getContext('2d'), x0, y0); g.drawImage(cv, x0, y0); }
    it.spr = { k: FASE.k, cv: cv, x: x0, y: y0 };
  }
  /* ---------- luces prendidas de noche ----------
     El tinte de la hora se multiplica sobre todo; de noche ese tinte es un mapa de luz: cada sala tiene sus luces de
     techo (una cada ~5 baldosas) y las lámparas suman su charco. Dentro de un charco el tinte se aclara hacia una luz
     cálida con una caída suave (sin tramar: escalado en pantalla, el tramado se veía como ruido). La luz no atraviesa
     paredes: cada charco solo pinta los píxeles donde se ve su zona (ver zonas()); las ventanas quedan en penumbra.
     Se arma una vez por fase y después solo se copia. */
  function hex(c) { var n = parseInt(c.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; }
  function cascara(pts) {   // envolvente convexa (monotone chain), en sentido horario en pantalla
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var cr = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }, lo = [], hi = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (hi.length > 1 && cr(hi[hi.length - 2], hi[hi.length - 1], pts[i]) <= 0) hi.pop(); hi.push(pts[i]); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  /* qué zona (sala o pasillo) se ve en cada píxel: se pintan los pisos y después la caja de cada mueble y pared en el
     orden de dibujo, cada una con el número de la zona hacia donde mira su cara visible. Así la luz respeta las paredes. */
  function zonas() {
    var filas = [], lista = [];
    salas.forEach(function (s, i) { lista.push({ r: s.r, id: i + 1 }); if (filas.indexOf(s.r[3]) < 0) filas.push(s.r[3]); });
    filas.forEach(function (y, i) { lista.push({ r: [LAT, y, FX, y + PAS], id: salas.length + 1 + i, pasillo: true }); });
    lista.push({ r: [0, 0, LAT, FY], id: salas.length + 1 + filas.length, pasillo: true, lateral: true });
    function zonaEn(x, y) { for (var i = 0; i < lista.length; i++) { var r = lista[i].r; if (x >= r[0] && x < r[2] && y >= r[1] && y < r[3]) return lista[i].id; } return 0; }
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H; var ctx = cv.getContext('2d'), g0 = N.g; N.g = ctx;
    var col = function (id) { return 'rgb(' + id + ',0,0)'; };
    lista.forEach(function (z) { N.quad(z.r[0], z.r[1], z.r[2], z.r[3], col(z.id)); });
    ordenar().forEach(function (it) {
      var b = it.b; if (!b || b.length < 5 || it.enSofa !== undefined) return;
      var x = b[2] - b[0] < .3 ? b[2] + .05 : (b[0] + b[2]) / 2, y = b[3] - b[1] < .3 ? b[3] + .05 : (b[1] + b[3]) / 2, pts = [];
      [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].forEach(function (c) { var q = iso(c[0], c[1]); pts.push(q, up(q, b[4])); });
      N.poly(cascara(pts), col(zonaEn(x, y)));
    });
    N.g = g0;
    var d = ctx.getImageData(0, 0, W, H).data, Z = new Uint8Array(W * H);
    for (var o = 0; o < Z.length; o++) Z[o] = d[o * 4 + 3] > 200 ? d[o * 4] : 0;
    return { Z: Z, lista: lista };
  }
  function luzPara(F) {
    var key = 'luz:' + F.k; if (pisos[key]) return pisos[key];
    var I = new Float32Array(W * H), zz = zonas(), Z = zz.Z, piso = [0];
    zz.lista.forEach(function (z) { piso[z.id] = z.pasillo ? .12 : .22; });   // luz mínima de cada zona, en toda la zona
    for (var o0 = 0; o0 < I.length; o0++) I[o0] = piso[Z[o0]] || 0;
    function charco(id, cx, cy, rx, ry, fuerza) {
      var bx0 = Math.max(0, Math.floor(cx - rx)), bx1 = Math.min(W - 1, Math.ceil(cx + rx)), by0 = Math.max(0, Math.floor(cy - ry)), by1 = Math.min(H - 1, Math.ceil(cy + ry));
      for (var y = by0; y <= by1; y++) for (var x = bx0; x <= bx1; x++) {
        var o = y * W + x; if (Z[o] !== id) continue;
        var dx = (x - cx) / rx, dy = (y - cy) / ry, d = Math.sqrt(dx * dx + dy * dy), v = (d >= 1 ? 0 : 1 - d * d) * fuerza;
        if (v > I[o]) I[o] = v;
      }
    }
    zz.lista.forEach(function (z) {
      var r = z.r, w = r[2] - r[0], h = r[3] - r[1], i, p;
      if (!z.pasillo) {   // salas: luces de techo, una cada ~5 baldosas, más las lámparas de la sala
        var n = Math.max(1, Math.round(w / 5)), ancho = w / n + PROF, cy = (r[1] + r[3]) / 2;
        for (i = 0; i < n; i++) { p = up(iso(r[0] + w * (i + .5) / n, cy), 8); charco(z.id, p[0], p[1], ancho * 12 * S * .62, ancho * 6 * S * .9, 1); }
        luces.forEach(function (l) { if (l.x < r[0] || l.x > r[2] || l.y < r[1] || l.y > r[3]) return; var q = up(iso(l.x, l.y), l.z * .4); charco(z.id, q[0], q[1], l.r * 12 * S * 1.2, l.r * 6 * S * 1.5, 1.15); });
      } else {            // pasillos: spots más tenues, uno cada ~3.5 baldosas
        var largo = z.lateral ? h : w, m = Math.max(1, Math.round(largo / 3.5)), rr = largo / m;
        for (i = 0; i < m; i++) { p = up(z.lateral ? iso((r[0] + r[2]) / 2, r[1] + rr * (i + .5)) : iso(r[0] + rr * (i + .5), (r[1] + r[3]) / 2), 3); charco(z.id, p[0], p[1], rr * 12 * S * .75, rr * 6 * S * .9, .6); }
      }
    });
    var t = hex(F.tint), c = hex('#fff1dc'), k = .8 * F.glow, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), dd = img.data;
    for (var o = 0, j = 0; o < I.length; o++, j += 4) { var m = Math.min(1, I[o]) * k; dd[j] = t[0] + (c[0] - t[0]) * m; dd[j + 1] = t[1] + (c[1] - t[1]) * m; dd[j + 2] = t[2] + (c[2] - t[2]) * m; dd[j + 3] = 255; }
    ctx.putImageData(img, 0, 0); pisos[key] = cv; return cv;
  }

  /* ---------- etiquetas ---------- */
  function etiqueta(tipo, texto, color) {
    var el = document.createElement('div'); el.className = 'etq etq-' + tipo;
    var d = document.createElement('div'); d.className = 'etq-in'; el.appendChild(d);
    if (color) { var p = document.createElement('i'); p.style.background = color; d.appendChild(p); }
    var s = document.createElement('span'); s.textContent = texto; d.appendChild(s);
    capa.appendChild(el); var e = { el: el, wx: 0, wy: 0, z: 0, oculta: false }; etiquetas.push(e); return e;
  }
  var VERBO = { pensando: 'pensando', leyendo: 'leyendo', escribiendo: 'escribiendo', buscando: 'buscando', consultando: 'consultando a', trabajando: 'trabajando', armando: 'armando' };
  function armarEtiquetas() {
    etiquetas.forEach(function (e) { if (e.el.parentNode) e.el.parentNode.removeChild(e.el); }); etiquetas = []; etqSalas = [];
    salas.forEach(function (s) { var e = etiqueta('sala', s.nombre, s.tipo === 'depto' ? s.color : null); e.sala = s; e.wx = s.r[0] + .5; e.wy = s.r[1] + .3; e.z = 18; etqSalas.push(e); s.etq = e; });
    /* con secretaría, la recepción no lleva el cartel del Creador: se le pide a ella (docs/plan-secretaria-creadora.md) */
    if (recepcion && !(App.secretaria && App.secretaria())) { var c = etiqueta('sala', 'Armar con el Creador', '#f2c14e'); c.wx = recepcion.x - .4; c.wy = recepcion.y - .6; c.z = 16; c.creador = true; }
    Object.keys(figs).forEach(function (id) { var f = figs[id];
      f.etqNombre = etiqueta('agente', f.yo ? 'Vos' : f.a.nombre || id, null); f.etqNombre.fig = f;
      if (!f.yo) {
        f.etqTarea = etiqueta('tarea', '', null); var d = f.etqTarea.el.firstChild; while (d.firstChild) d.removeChild(d.firstChild);
        f.etqTarea.titulo = document.createElement('b'); f.etqTarea.detalle = document.createElement('small'); d.appendChild(f.etqTarea.titulo); d.appendChild(f.etqTarea.detalle); f.etqTarea.fig = f;
        f.etqFaro = etiqueta('faro', '', null); var df = f.etqFaro.el.firstChild; while (df.firstChild) df.removeChild(df.firstChild); df.appendChild(document.createElement('b')); f.etqFaro.fig = f;
      }
    });
    if (bandeja) { etqBandeja = etiqueta('bandeja', '', null); var ib = document.createElement('i'); etqBandeja.el.firstChild.insertBefore(ib, etqBandeja.el.firstChild.firstChild); etqBandeja.wx = bandeja.x; etqBandeja.wy = bandeja.y; etqBandeja.z = 22; }
    pintarEtiquetas();
  }
  function pintarEtiquetas() {
    Object.keys(figs).forEach(function (id) {
      var f = figs[id], t = f.bib ? (bibDatos.corriendo ? { estado: 'escribiendo', tarea: 'Bibliotecario', detalle: 'ordenando la memoria' } : null) : trabajo[id], hab = reunionActual.quien === id;
      var faro = f.bib ? (bibDatos.pendientes && !bibDatos.corriendo ? 'aviso' : null) : faroDe[id];
      if (f.etqNombre) { var vis = elegido === id || ocupados[id] || hab || (hover && hover.tipo === 'agente' && hover.id === id) || (hover && hover.tipo === 'yo' && f.yo) || (f.bib && hover && hover.id === 'bibliotecario');
        f.etqNombre.oculta = !vis || (t && !f.ruta && f.modo === 'puesto'); f.etqNombre.el.classList.toggle('activa', elegido === id); f.etqNombre.el.classList.toggle('ocupado', !!ocupados[id]); f.etqNombre.el.classList.toggle('hablando', hab); }
      if (f.etqTarea) { f.etqTarea.oculta = !t || f.modo !== 'puesto';
        if (t) { f.etqTarea.titulo.textContent = t.tarea || (t.origen === 'reunion' ? 'En reunión' : 'Trabajando'); f.etqTarea.detalle.textContent = t.detalle || ((VERBO[t.estado] || t.estado) + (t.objetivo ? ' ' + t.objetivo : '')); f.etqTarea.el.dataset.estado = t.estado; } }
      if (f.etqFaro) { f.etqFaro.oculta = !faro; f.etqFaro.el.firstChild.firstChild.textContent = faro === 'error' ? '!' : '•'; f.etqFaro.el.dataset.tipo = faro || ''; }
    });
    if (etqBandeja) { var n = muroDatos.sinRevisar || 0; etqBandeja.el.querySelector('span').textContent = n ? n + ' para revisar' : 'Bandeja al día'; etqBandeja.el.classList.toggle('al-dia', !n); }
    etqSalas.forEach(function (e) { e.el.classList.toggle('hover', !!(hover && e.sala && hover.sala === e.sala)); });
  }
  function moverEtiquetas() {
    var dpr = window.devicePixelRatio || 1;
    etiquetas.forEach(function (e) {
      var x, y;
      if (e.fig) { var f = e.fig, alto = (f.sit && !f.ruta ? (drawChar.ALTO_SENTADO || 26) + 10 : (drawChar.ALTO || 43)) + 4;
        var extra = e.el.classList.contains('etq-tarea') ? 10 : e.el.classList.contains('etq-faro') ? 8 : 4; var p = iso(f.x, f.y); x = p[0]; y = p[1] - alto - extra; }
      else { var q = up(iso(e.wx, e.wy), e.z); x = q[0]; y = q[1]; }
      var sx = (x * cam.kv + cam.dx) / dpr, sy = (y * cam.kv + cam.dy) / dpr;
      var fuera = sx < -200 || sy < -60 || sx > vista.clientWidth + 200 || sy > vista.clientHeight + 60;
      e.el.style.display = e.oculta || fuera ? 'none' : '';
      if (!e.oculta && !fuera) e.el.style.transform = 'translate(' + R(sx) + 'px,' + R(sy) + 'px)';
    });
    if (pin) { var pf = figs[pin.id];
      if (!pf || performance.now() > pin.hasta) { pin.el.remove(); pin = null; }
      else { var pp = iso(pf.x, pf.y), pa = (pf.sit && !pf.ruta ? (drawChar.ALTO_SENTADO || 26) + 10 : (drawChar.ALTO || 43)) + 6;
        pin.el.style.transform = 'translate(' + R((pp[0] * cam.kv + cam.dx) / dpr) + 'px,' + R(((pp[1] - pa) * cam.kv + cam.dy) / dpr) + 'px)'; pedir(); } }
  }
  /* «¿Dónde está?»: un pin como el de un mapa cae sobre la persona, la sigue si camina y se va solo */
  var pin = null;
  function marcar(id) {
    if (!figs[id] || !capa) return false;
    if (pin) pin.el.remove();
    var el = document.createElement('div'); el.className = 'pin-mapa';
    el.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12 21s-6.5-5.8-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z" fill="#d6453a" stroke="#fff" stroke-width="1.4"/><circle cx="12" cy="9.8" r="2.4" fill="#fff"/></svg>';
    capa.appendChild(el); pin = { id: id, el: el, hasta: performance.now() + 2800 };
    enfocarAgente(id); moverEtiquetas(); pedir(); return true;
  }
  /* el panel de la izquierda cambió de ancho: si había alguien enfocado, se vuelve a centrar en el hueco nuevo */
  function margen(px) {
    px = Math.max(0, Math.round(px || 0)); if (px === margenIzq) return;
    margenIzq = px;
    if (elegido && figs[elegido]) enfocarAgente(elegido); else if (enGeneral()) irCamara(encuadreGeneral());
  }

  /* ---------- cámara ---------- */
  /* cam.k es el zoom; puede quedar fraccionario mientras se pellizca, y al soltar se acomoda al entero más cercano
     (el pixel art se ve nítido en múltiplos enteros). kMin es el encuadre general: si el mundo no entra ni a 1×,
     es la escala que lo hace entrar entero */
  var cam = { cx: 0, cy: 0, k: 1, kv: 1, dx: 0, dy: 0 }, kLejos = 1, kMin = 1, kCerca = 3, tween = null, inercia = null, camSucia = false, cw = 1, ch = 1;
  /* px (CSS) tapados por un panel a la izquierda: la cámara centra en el hueco que queda a la derecha */
  var margenIzq = 0;
  function corrimiento(k) { return margenIzq / 2 * (window.devicePixelRatio || 1) / (k || 1); }
  function encuadreGeneral() { return { cx: W / 2 - corrimiento(kMin), cy: H / 2 - 10, k: kMin }; }
  function enGeneral() { return cam.k <= kMin + 1e-3; }
  function kMax() { return kCerca + 3; }
  function acotarK(k) { return Math.max(kMin, Math.min(kMax(), k)); }
  function ajustar() {
    if (!vista) return;
    var dpr = window.devicePixelRatio || 1, cssW = cont.clientWidth || 800, cssH = cont.clientHeight || 600, era = enGeneral();
    cw = vista.width = Math.max(1, R(cssW * dpr)); ch = vista.height = Math.max(1, R(cssH * dpr));
    var fit = Math.min(cw / W, ch / H);
    kLejos = Math.max(1, Math.min(Math.floor(cw / W), Math.floor(ch / H)));
    kMin = fit < 1 ? fit : kLejos;
    kCerca = Math.max(kLejos + 1, Math.floor(cw / 420));
    if (era || cam.k < kMin) cam.k = kMin; else if (cam.k > kMax()) cam.k = kMax();
    limitar(); presentar(); if (items.length) pedir(); else sucio = true;   // antes de construir no hay mundo que dibujar
  }
  function calcular() { var k = cam.k; cam.kv = k; cam.dx = R(cw / 2 - cam.cx * k); cam.dy = R(ch / 2 - cam.cy * k); }
  function presentar() {
    if (!vc) return;
    calcular(); camSucia = false;
    var k = cam.kv;
    vc.setTransform(1, 0, 0, 1, 0, 0); vc.clearRect(0, 0, cw, ch);
    vc.imageSmoothingEnabled = k < 1; vc.drawImage(mundo, cam.dx, cam.dy, W * k, H * k);
    moverEtiquetas();
  }
  /* la cámara cambió por un gesto: se recalcula ya (para que el próximo evento convierta bien las coordenadas) pero se
     dibuja una sola vez por cuadro, no en cada evento del dedo */
  function moverCam() { calcular(); camSucia = true; if (!pausado) despertar(); }
  function limitado(c) { var k = c.k, hw = cw / 2 / k, hh = ch / 2 / k;
    return { cx: Math.max(Math.min(hw, W / 2), Math.min(Math.max(W - hw, W / 2), c.cx)), cy: Math.max(Math.min(hh, H / 2), Math.min(Math.max(H - hh, H / 2), c.cy)), k: k }; }
  function limitar() { var c = limitado(cam); cam.cx = c.cx; cam.cy = c.cy; }
  /* encuadre con zoom k que deja el punto del mundo (wx, wy) bajo el punto de pantalla (px0, py0) */
  function anclar(k, px0, py0, wx, wy) { return limitado({ cx: wx - (px0 - cw / 2) / k, cy: wy - (py0 - ch / 2) / k, k: k }); }
  function irCamara(to, dur) { inercia = null; if (reducido) { Object.assign(cam, to); tween = null; } else tween = { from: { cx: cam.cx, cy: cam.cy, k: cam.k }, to: to, t0: performance.now(), dur: dur || 650 }; pedir(); }
  function encuadrar() { irCamara(encuadreGeneral()); }
  function enfocar(x, y) { var p = iso(x, y); irCamara({ cx: p[0] - corrimiento(kCerca), cy: p[1] - 24, k: kCerca }); return true; }
  function enfocarAgente(id) { var f = figs[id]; if (!f) return false; return enfocar(f.x, f.y); }
  function enfocarLugar(tipo) {
    if (tipo === 'entregables' && bandeja) { var p = iso(bandeja.x, bandeja.y); irCamara({ cx: p[0], cy: p[1] - 20, k: kCerca + 1 }); return true; }
    if (tipo === 'creador' && recepcion) return enfocar(recepcion.x, recepcion.y);
    var t = tipo === 'yo' ? 'direccion' : tipo, s = salas.filter(function (r) { return r.tipo === t; })[0];
    if (!s) return false; return enfocar((s.r[0] + s.r[2]) / 2, (s.r[1] + s.r[3]) / 2);
  }

  /* ---------- entrada: clic, hover, zoom y arrastre ---------- */
  function aMundo(e) { var r = vista.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; return [((e.clientX - r.left) * dpr - cam.dx) / cam.kv, ((e.clientY - r.top) * dpr - cam.dy) / cam.kv]; }
  function aPiso(x, y) { var u = (x - N.OX) / (12 * S), v = (y - N.OY) / (6 * S); return [(u + v) / 2, (v - u) / 2]; }
  function golpe(e) {
    var m = aMundo(e), mejor = null;
    Object.keys(figs).forEach(function (id) { var f = figs[id]; if (f.sx == null) return;
      if (m[0] >= f.sx - 8 && m[0] <= f.sx + 8 && m[1] >= f.top && m[1] <= f.sy + 1 && (!mejor || f.x + f.y > mejor.f.x + mejor.f.y)) mejor = { f: f }; });
    if (mejor) return mejor.f.bib ? { tipo: 'biblioteca', id: 'bibliotecario' } : mejor.f.yo ? { tipo: 'yo' } : { tipo: 'agente', id: mejor.f.a.id };
    var w = aPiso(m[0], m[1]);
    if (bandeja && Math.abs(w[0] - bandeja.x - .15) < .4 && Math.abs(w[1] - bandeja.y - .1) < .4) return { tipo: 'entregables', texto: etqBandeja ? etqBandeja.el.textContent : '' };
    if (recepcion && Math.abs(w[0] - recepcion.x) < 1.2 && Math.abs(w[1] - recepcion.y + .5) < .8) return { tipo: 'creador' };
    var s = salas.filter(function (r) { return w[0] >= r.r[0] && w[0] <= r.r[2] && w[1] >= r.r[1] && w[1] <= r.r[3]; })[0];
    if (s && s.tipo !== 'depto' && s.tipo !== 'recepcion') return { tipo: s.tipo, sala: s };
    return null;
  }
  var ptrs = new Map(), arr = null, movido = false, pinch = null, acum = 0, centroGesto = null, finPellizco = 0;
  function aPantalla(x, y) { var r = vista.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; return [(x - r.left) * dpr, (y - r.top) * dpr]; }
  function empezarArrastre(x, y, t) { arr = { x: x, y: y, cx: cam.cx, cy: cam.cy, t: t, vx: 0, vy: 0, px: x, py: y }; }
  function empezarPinch() {
    var v = Array.from(ptrs.values()), m = aPantalla((v[0][0] + v[1][0]) / 2, (v[0][1] + v[1][1]) / 2);
    tween = null; inercia = null; arr = null; movido = true;   // un toque con dos dedos no es un clic
    pinch = { d: Math.max(1, Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1])), k: cam.k, wx: (m[0] - cam.dx) / cam.kv, wy: (m[1] - cam.dy) / cam.kv };
    centroGesto = m;
  }
  /* al soltar todo: si el zoom quedó entre dos enteros se acomoda al más cercano, alrededor de donde estaban los dedos */
  function acomodarZoom() {
    var k = cam.k, nk = k < 1 ? k : Math.round(k);
    nk = acotarK(nk); if (Math.abs(nk - k) < 1e-3) return false;
    if (nk <= kMin + 1e-3) { irCamara(encuadreGeneral(), 220); return true; }
    var c = centroGesto || [cw / 2, ch / 2];
    irCamara(anclar(nk, c[0], c[1], (c[0] - cam.dx) / cam.kv, (c[1] - cam.dy) / cam.kv), 180); return true;
  }
  function conectar() {
    vista.addEventListener('wheel', function (e) {
      e.preventDefault();
      var dpr = window.devicePixelRatio || 1;
      if (!e.ctrlKey && e.deltaY % 1 !== 0 && Math.abs(e.deltaX) + Math.abs(e.deltaY) < 60 && !e.deltaMode) {   // trackpad con dos dedos: mover
        tween = null; inercia = null; cam.cx += e.deltaX * dpr / cam.kv; cam.cy += e.deltaY * dpr / cam.kv; limitar(); moverCam(); return; }
      var p = aPantalla(e.clientX, e.clientY);
      if (e.ctrlKey) {   // pellizco del trackpad: zoom continuo, y se acomoda al entero cuando se deja de pellizcar
        tween = null; inercia = null;
        var k = acotarK(cam.k * Math.exp(-e.deltaY * .01));
        Object.assign(cam, anclar(k, p[0], p[1], (p[0] - cam.dx) / cam.kv, (p[1] - cam.dy) / cam.kv)); moverCam();
        centroGesto = p; clearTimeout(finPellizco); finPellizco = setTimeout(function () { finPellizco = 0; acomodarZoom(); }, 160); return; }
      acum += e.deltaY; if (Math.abs(acum) < 40) return;
      zoom(paso(cam.k, acum < 0 ? 1 : -1), p[0], p[1]); acum = 0;
    }, { passive: false });
    vista.addEventListener('pointerdown', function (e) { vista.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 1) { movido = false; tween = null; inercia = null; empezarArrastre(e.clientX, e.clientY, e.timeStamp); }
      if (ptrs.size === 2) empezarPinch(); });
    vista.addEventListener('pointermove', function (e) {
      if (!ptrs.has(e.pointerId)) { if (e.pointerType === 'touch') return; var h = golpe(e); if (JSON.stringify(h && { t: h.tipo, i: h.id }) !== JSON.stringify(hover && { t: hover.tipo, i: hover.id })) { hover = h; vista.style.cursor = h ? 'pointer' : 'default'; pintarEtiquetas(); pedir(); if (cbPasar) cbPasar(h ? { tipo: h.tipo, id: h.id, texto: h.texto } : null); } return; }
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && ptrs.size >= 2) {   // pellizco: zoom continuo + mover con el punto medio de los dedos
        var v = Array.from(ptrs.values()), d = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]), m = aPantalla((v[0][0] + v[1][0]) / 2, (v[0][1] + v[1][1]) / 2);
        Object.assign(cam, anclar(acotarK(pinch.k * d / pinch.d), m[0], m[1], pinch.wx, pinch.wy)); centroGesto = m; moverCam(); return; }
      if (arr) { var dx = e.clientX - arr.x, dy = e.clientY - arr.y; if (Math.abs(dx) + Math.abs(dy) > 6) movido = true;
        if (movido) { tween = null; var dp = window.devicePixelRatio || 1; cam.cx = arr.cx - dx * dp / cam.kv; cam.cy = arr.cy - dy * dp / cam.kv; limitar(); moverCam(); vista.style.cursor = 'grabbing';
          var dtm = e.timeStamp - arr.t; if (dtm > 0) { var a = Math.min(1, dtm / 50); arr.vx += ((e.clientX - arr.px) / dtm - arr.vx) * a; arr.vy += ((e.clientY - arr.py) / dtm - arr.vy) * a; }
          arr.t = e.timeStamp; arr.px = e.clientX; arr.py = e.clientY; } }
    });
    function soltar(e, cancelado) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size === 1) {   // de dos dedos a uno: sigue arrastrando con el que quedó, sin saltos
        pinch = null; var q = Array.from(ptrs.values())[0]; empezarArrastre(q[0], q[1], e.timeStamp); return; }
      if (ptrs.size) return;
      var a = arr; arr = null; pinch = null; vista.style.cursor = hover ? 'pointer' : 'default';
      if (acomodarZoom()) return;
      /* inercia: si se soltó en movimiento, la vista sigue deslizándose y frena sola */
      if (!cancelado && !reducido && a && movido && e.timeStamp - a.t < 80 && Math.hypot(a.vx, a.vy) > .25) {
        var dp = window.devicePixelRatio || 1; inercia = { vx: -a.vx * dp / cam.kv, vy: -a.vy * dp / cam.kv, t: performance.now() }; pedir(); }
    }
    vista.addEventListener('pointerup', function (e) { var era = !movido && ptrs.size === 1; soltar(e); if (!era) return; var h = golpe(e); if (!h) return;
      if (h.tipo === 'agente') cbAgente(h.id); else cbLugar(h.tipo); });
    vista.addEventListener('pointercancel', function (e) { soltar(e, true); });
    vista.addEventListener('pointerleave', function () { if (hover) { hover = null; pintarEtiquetas(); pedir(); if (cbPasar) cbPasar(null); } });
  }
  /* un paso de la ruedita: al entero siguiente (o al encuadre general por abajo) */
  function paso(k, dir) {
    if (dir > 0) return k < 1 ? 1 : Math.floor(k + 1e-3) + 1;
    var n = Math.ceil(k - 1e-3) - 1; return n < 1 ? kMin : Math.max(n, kMin);
  }
  /* zoom de la ruedita: inmediato, como siempre en la compu. Con una animación, cada muesca de una ruedita rápida
     calculaba el paso desde el zoom a mitad de camino y apuntaba al mismo entero, así que la vista se quedaba trabada */
  function zoom(nk, px0, py0) {
    nk = acotarK(nk); if (Math.abs(nk - cam.k) < 1e-3) return;
    tween = null; inercia = null;
    Object.assign(cam, nk <= kMin + 1e-3 ? encuadreGeneral() : anclar(nk, px0, py0, (px0 - cam.dx) / cam.kv, (py0 - cam.dy) / cam.kv));
    moverCam();
  }
  function avanzarInercia(now) {
    var dt = Math.min(50, now - inercia.t); inercia.t = now;
    var ax = cam.cx, ay = cam.cy; cam.cx += inercia.vx * dt; cam.cy += inercia.vy * dt; limitar();
    if (cam.cx === ax) inercia.vx = 0; if (cam.cy === ay) inercia.vy = 0;   // chocó con el borde
    var fr = Math.pow(.996, dt); inercia.vx *= fr; inercia.vy *= fr;
    if (Math.hypot(inercia.vx, inercia.vy) * cam.kv < .03) inercia = null;
  }

  /* ---------- ciclo ---------- */
  function pedir() { sucio = true; if (pausado) return; despertar(); }
  function despertar() { if (dormido) { clearTimeout(dormido); dormido = 0; } if (!raf) raf = requestAnimationFrame(cuadro); }
  function cuadro(now) {
    raf = 0; if (pausado) return;
    var mover = !!tween || !!inercia || camSucia;
    if (tween) { var p = Math.min(1, (now - tween.t0) / (tween.dur || 650)), e = 1 - Math.pow(1 - p, 3), f = tween.from, to = tween.to;
      cam.cx = f.cx + (to.cx - f.cx) * e; cam.cy = f.cy + (to.cy - f.cy) * e; cam.k = p < 1 ? f.k + (to.k - f.k) * e : to.k; if (p >= 1) tween = null; }
    if (inercia) avanzarInercia(now);
    var dt = ultimo ? Math.min(.1, (now - ultimo) / 1000) : 0; ultimo = now;
    Object.keys(figs).forEach(function (id) { avanzar(figs[id], dt); });
    if (now - ultimoRevisar > 1000) { ultimoRevisar = now; revisar(now); }
    /* el mundo se vuelve a dibujar solo si algo cambió o si toca el siguiente cuadro de la animación (cada 125 ms);
       y se copia a la pantalla solo si se redibujó o se movió la cámara: repetir el mismo cuadro 120 veces por segundo
       era lo que hacía arrastrar la app */
    var t2 = Math.floor(now / 125), animado = !reducido && t2 !== T;
    if (now - ultimoTick > 60 && (sucio || animado)) { ultimoTick = now; T = t2; sucio = false; render(now); mover = true; }   // render puede volver a marcarlo (piezas en viaje)
    if (mover) presentar();
    /* con la cámara quieta, nadie caminando y nada pendiente, no hace falta despertarse en cada refresco de pantalla
       (120 por segundo): se duerme hasta el próximo cuadro de la animación, o un segundo si no hay animación.
       pedir() lo despierta antes si cambia algo */
    var ocupado = tween || inercia || sucio || Object.keys(figs).some(function (id) { return figs[id].ruta; });
    if (ocupado) { raf = requestAnimationFrame(cuadro); return; }
    ultimo = 0;
    var ahora = performance.now(), espera = reducido ? 1000 : 125 - (ahora % 125) + 1;
    dormido = setTimeout(function () { dormido = 0; if (!pausado) despertar(); }, espera);
  }

  /* ---------- interfaz pública ---------- */
  function iniciar(contenedor) {
    cont = contenedor;
    vista = document.createElement('canvas'); vista.className = 'lienzo-oficina lienzo-pixel'; vista.style.width = '100%'; vista.style.height = '100%';
    capa = document.createElement('div'); capa.className = 'capa-oficina';
    cont.appendChild(vista); cont.appendChild(capa);
    vc = vista.getContext('2d');
    mundo = document.createElement('canvas'); g = mundo.getContext('2d'); N.g = g;
    conectar();
    ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (ev) { window.addEventListener(ev, function () { ultimaActividad = performance.now(); }, { passive: true, capture: true }); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') ultimaActividad = performance.now(); });
    if (window.ResizeObserver) new ResizeObserver(ajustar).observe(cont); else window.addEventListener('resize', ajustar);
    ajustar(); return true;
  }
  function construir(oficina, perfil) {
    try {
      oficina = oficina || {}; oficinaNombre = oficina.nombre || '';
      deptoColor = {}; (oficina.departamentos || []).forEach(function (d) { deptoColor[d.id] = d.color; });
      planificar(oficina, perfil);
      var oxNuevo = FY * 12 * S + 40, wN = R(oxNuevo + FX * 12 * S + 40), oyN = WH * S + 34, hN = R(oyN + (FX + FY) * 6 * S + 46);
      var cambio = wN !== W || hN !== H;
      N.OX = oxNuevo; N.OY = oyN; W = wN; H = hN; mundo.width = W; mundo.height = H; N.g = g; pisos = {};
      amueblar(perfil);
      var vivos = {};
      (oficina.agentes || []).forEach(function (a) { var p = puestos[a.id]; if (!p) return; var f = figura(a, Object.assign({ sit: true }, p)); f.semilla = hashStr(a.id) % 97; vivos[a.id] = 1; });
      if (despacho) { figura({ id: '__yo', nombre: (perfil && perfil.nombre) || 'Vos', avatar: perfil && perfil.avatar }, Object.assign({ sit: true }, despacho), true); vivos.__yo = 1; }
      if (puestoBib) { figura({ id: BIB_ID, nombre: 'Bibliotecario', avatar: BIB_AVATAR }, puestoBib).semilla = 7; vivos[BIB_ID] = 1; }
      Object.keys(figs).forEach(function (id) { if (!vivos[id]) delete figs[id]; });
      armarEtiquetas();
      if (cambio || !cam.k) Object.assign(cam, encuadreGeneral());
      ajustar(); revisar(performance.now()); pedir();
      return Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }
  function actividad(mapa) { trabajo = mapa || {}; pintarEtiquetas(); revisar(performance.now()); pedir(); }
  function faros(mapa) { faroDe = mapa || {}; pintarEtiquetas(); revisar(performance.now()); pedir(); }
  function ocupado(id, si) { if (si) ocupados[id] = true; else delete ocupados[id]; pintarEtiquetas(); revisar(performance.now()); pedir(); }
  function elegir(id) { if ((id || null) !== elegido) elegidoDesde = performance.now(); elegido = id || null; pintarEtiquetas(); revisar(performance.now()); pedir(); }
  function reunion(ids, quien) { reunionActual = { ids: (ids || []).slice(0, 10), quien: quien || null }; pintarEtiquetas(); revisar(performance.now()); pedir(); }
  function finReunion() { reunion([], null); }
  function muro(entregas, sinRevisar) { muroDatos = { entregas: entregas || [], sinRevisar: sinRevisar || 0 }; pintarEtiquetas(); pedir(); }
  /* lo que sabe la Biblioteca de la memoria: {corriendo, propuesta, choques} (lo mismo que devuelve /api/memoria) */
  function bibliotecario(st) {
    st = st || {};
    var nuevo = { corriendo: !!st.corriendo, pendientes: (st.choques || 0) + (st.propuesta ? 1 : 0) };
    if (nuevo.corriendo === bibDatos.corriendo && nuevo.pendientes === bibDatos.pendientes) return;
    bibDatos = nuevo; pintarEtiquetas(); pedir();
  }
  function pausar(si) { pausado = !!si; if (pausado && dormido) { clearTimeout(dormido); dormido = 0; } if (!pausado) pedir(); }

  return {
    iniciar: iniciar, construir: construir, alElegirAgente: function (fn) { cbAgente = fn || function () {}; }, alElegirLugar: function (fn) { cbLugar = fn || function () {}; },
    alPasar: function (fn) { cbPasar = fn; }, elegir: elegir, ocupado: ocupado, reunion: reunion, finReunion: finReunion, encuadrar: encuadrar, actividad: actividad,
    faros: faros, enfocar: function (x, z) { return enfocar(x, z); }, enfocarAgente: enfocarAgente, margen: margen, marcar: marcar, enfocarLugar: enfocarLugar, muro: muro, pieza: pieza, pedir: pedir, pausar: pausar, bibliotecario: bibliotecario,
    pixel: true, _estado: function () { return { salas: salas.length, figuras: Object.keys(figs).length, items: items.length, W: W, H: H, cam: cam, fase: FASE && FASE.k,
      caminando: Object.keys(figs).filter(function (id) { return figs[id].ruta; }).length, dormido: !!dormido, piezas: piezas.length }; }
  };
})();
