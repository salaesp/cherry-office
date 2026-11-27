/* Apariencia de los agentes: retratos, editor y traducción desde el avatar LEGO de antes (datos guardados).
   El avatar se guarda en las mismas claves de siempre: los colores (colorPiel, colorPelo, colorTorso, colorPiernas,
   colorAccesorio) vienen de la época de la maqueta LEGO; peinado, prendas y accesorio pixel van en pxPelo, pxArriba,
   pxAbajo y pxAccesorio. Si faltan, salen del avatar LEGO (pelo, torso, piernas, sombrero) o de la semilla. */
window.App = window.App || {};
App.Pixel = (function () {
  'use strict';
  var PELOS = ['corto', 'peinado', 'alto', 'bob', 'largo', 'coletas', 'cola', 'rodete', 'pelado', 'rapado'];
  var ARRIBAS = ['remera', 'polo', 'camisa', 'campera', 'traje', 'buzo', 'musculosa', 'jardinero', 'vestido'];
  var ABAJOS = ['pantalon', 'short', 'pollera'];
  var ACCES = ['ninguno', 'gorra', 'vincha'];
  var NOMBRE = { corto: 'Corto', peinado: 'Peinado al costado', alto: 'Parado', bob: 'Bob', largo: 'Largo', coletas: 'Colitas', cola: 'Cola de caballo', rodete: 'Rodete', pelado: 'Pelado con costados', rapado: 'Rapado',
    remera: 'Remera', polo: 'Chomba', camisa: 'Camisa', campera: 'Campera', traje: 'Traje', buzo: 'Buzo', musculosa: 'Musculosa', jardinero: 'Jardinero', vestido: 'Vestido',
    pantalon: 'Pantalón', short: 'Short', pollera: 'Pollera', ninguno: 'Nada', gorra: 'Gorra', vincha: 'Vincha' };
  var PIEL = ['#ffe1c4', '#f7d2a8', '#e0a77f', '#c08a5f', '#8a5a3c', '#5a3a26'];
  var PELO_C = ['#2e2d3d', '#1c1c22', '#5b3a29', '#8b4532', '#d4793a', '#ecca6e', '#cfc6bb'];
  var ROPA = ['#e2574c', '#d23a33', '#f08a2a', '#f2b84b', '#4fb176', '#2bb39a', '#4a80c6', '#2c3f78', '#9c88c0', '#4a4d55', '#2a2a30', '#f2f2f2'];
  var ABAJO_C = ['#3d4262', '#2c3f78', '#253a72', '#4a4d55', '#2a2a30', '#6b5a44', '#2ba59a', '#f08a2a', '#e8e2d0'];
  var ACC_C = ['#f0d04a', '#e2574c', '#4a80c6', '#4fb176', '#2a2a30', '#f2f2f2'];
  var CALZADO = [['#24242a', '#18181c'], ['#c8622e', '#7a3a1c'], ['#f2f2f2', '#c9ccd4'], ['#d23a33', '#f2f2f2'], ['#4a80c6', '#f2f2f2']];
  var HEX = /^#[0-9a-f]{6}$/i;

  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function pick(lista, s, sal) { return lista[hash(s + ':' + sal) % lista.length]; }

  /* traducción de piezas LEGO a prendas pixel */
  var DE_PELO = { 'corto-liso': 'corto', 'corto-clasico': 'corto', 'despeinado': 'corto', 'ondas-cortas': 'corto', 'hacia-atras': 'peinado', 'entradas': 'pelado',
    'corto-lateral': 'peinado', 'corto-costado': 'peinado', 'jopo': 'peinado', 'parado': 'alto', 'afro': 'alto', 'bob': 'bob', 'bob-raya': 'bob', 'media-melena': 'bob', 'hombros': 'bob',
    'largo-lacio': 'largo', 'largo-ondulado': 'largo', 'rulos': 'largo', 'largo-mechon': 'largo', 'rodete': 'rodete', 'rodete-alto': 'rodete', 'rodete-bajo': 'rodete',
    'cola': 'cola', 'cola-flequillo': 'cola', 'coletas': 'coletas' };
  function deTorso(t) {
    t = t || '';
    if (/^(traje|traje-gris|tres-piezas|frac|pinstripe|saco-mujer|saco-rosa|saco-panuelo|saco-collar|saco-bufanda|saco-camisa)$/.test(t)) return 'traje';
    if (/^(campera|saco-abierto|buzo-abierto|chaleco-pluma)$/.test(t)) return 'campera';
    if (/^(remera|remera-v|cuello-redondo|liso|credencial)$/.test(t)) return 'remera';
    if (/camisa|blusa|cuello-abierto|corbata/.test(t)) return 'camisa';
    if (/cardigan|sweater|tejido|rombos|escoces|chaleco|bufanda|buzo/.test(t)) return 'buzo';
    return t ? 'remera' : null;
  }
  var AMARILLO = '#f6c928', BLANCA = '#f4f2ec';

  /* avatar guardado -> lo que necesita drawChar */
  function spec(av, semilla) {
    av = av || {};
    var s = av.semilla || semilla || 'x';
    var pelo = PELOS.indexOf(av.pxPelo) >= 0 ? av.pxPelo : (DE_PELO[av.pelo] || pick(['corto', 'peinado', 'bob', 'largo', 'corto', 'cola', 'alto'], s, 'pp'));
    var arriba = ARRIBAS.indexOf(av.pxArriba) >= 0 ? av.pxArriba : (deTorso(av.torso) || pick(['remera', 'polo', 'camisa', 'campera', 'traje', 'buzo'], s, 'pa'));
    var abajo = ABAJOS.indexOf(av.pxAbajo) >= 0 ? av.pxAbajo : (/^falda/.test(av.piernas || '') ? 'pollera' : (av.piernas ? 'pantalon' : pick(['pantalon', 'pantalon', 'pantalon', 'short', 'pollera'], s, 'pb')));
    var piel = (av.colorPiel || '').toLowerCase();
    if (!HEX.test(piel) || piel === AMARILLO) piel = pick(PIEL, s, 'pi');      // la piel amarilla de LEGO pasa a un tono natural
    else if (piel === BLANCA) piel = PIEL[0];
    var acc = ACCES.indexOf(av.pxAccesorio) >= 0 ? av.pxAccesorio : (/^gorra/.test(av.sombrero || '') ? 'gorra' : 'ninguno');
    var colAcc = HEX.test(av.colorAccesorio || '') ? av.colorAccesorio : pick(ACC_C, s, 'pk');
    var cal = pick(CALZADO, s, 'pz');
    var c = {
      skc: piel,
      hcc: HEX.test(av.colorPelo || '') ? av.colorPelo : pick(PELO_C, s, 'ph'),
      hair: pelo,
      top: { t: arriba, c: HEX.test(av.colorTorso || '') ? av.colorTorso : pick(ROPA, s, 'pt'), in: '#f2f2f2',
        tie: (arriba === 'traje' || arriba === 'camisa') && (/corbata|traje|tres-piezas|pinstripe/.test(av.torso || '') || hash(s + ':tie') % 2) ? (HEX.test(av.colorAccesorio || '') ? av.colorAccesorio : '#c8333a') : null },
      leg: { t: arriba === 'vestido' ? 'nada' : abajo, c: HEX.test(av.colorPiernas || '') ? av.colorPiernas : pick(ABAJO_C, s, 'pl') },
      shoe: { c: cal[0], sole: cal[1] }, sock: hash(s + ':so') % 2, watch: hash(s + ':w') % 4 === 0 ? 1 : 0, glasses: 0
    };
    if (acc === 'gorra') c.cap = colAcc; else if (acc === 'vincha') c.band = colAcc;
    return c;
  }

  /* retrato: busto (cabeza y hombros) o cuerpo entero, agrandado sin suavizar. Devuelve una promesa con un data URL. */
  var cache = {};
  function retrato(av, semilla, tam, encuadre) {
    tam = tam || 96;
    var clave = JSON.stringify([av || {}, semilla || '', tam, encuadre || '']);
    if (cache[clave]) return cache[clave];
    var c = spec(av, semilla), alto = (window.drawChar && drawChar.ALTO) || 43;
    var cuerpo = encuadre === 'cuerpo';
    var w = cuerpo ? 24 : 20, hh = cuerpo ? alto + 6 : 20;
    var t = document.createElement('canvas'); t.width = w; t.height = hh;
    var g = t.getContext('2d');
    if (window.drawChar) drawChar(g, w / 2, cuerpo ? hh - 2 : alto + 3, c, 'se', false, false, 0, 'quieto');
    var out = document.createElement('canvas'); out.width = tam; out.height = tam;
    var o = out.getContext('2d'); o.imageSmoothingEnabled = false;
    var k = Math.max(1, Math.floor(tam / Math.max(w, hh)));
    o.drawImage(t, Math.round((tam - w * k) / 2), Math.round((tam - hh * k) / 2) + (cuerpo ? 0 : Math.round(k)), w * k, hh * k);
    cache[clave] = Promise.resolve(out.toDataURL('image/png'));
    return cache[clave];
  }

  /* editor con la misma forma que App.EditorAvatar: {el, valor(), retratar()} */
  function editor(avatar, semilla, op) {
    op = op || {};
    var h = App.h, av = JSON.parse(JSON.stringify(avatar || {}));
    var s0 = function () { return av.semilla || (semilla && semilla()) || 'x'; };
    // fija las prendas y colores que hoy se ven, así el editor arranca de lo que ya tenía
    (function fijar() { var c = spec(av, s0()); av.pxPelo = c.hair; av.pxArriba = c.top.t; av.pxAbajo = c.leg.t === 'nada' ? 'pantalon' : c.leg.t; av.colorPiel = c.skc; av.colorPelo = c.hcc; av.colorTorso = c.top.c; av.colorPiernas = c.leg.c;
      av.pxAccesorio = c.cap ? 'gorra' : c.band ? 'vincha' : 'ninguno'; if (c.cap || c.band) av.colorAccesorio = c.cap || c.band; })();
    var lienzo = h('canvas.grande.pixel-vista', { width: 64, height: 52 });
    var controles = h('div'), tt = 0;
    function dibujar() {
      var g = lienzo.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, 64, 52);
      var c = spec(av, s0());
      g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(12, 48, 13, 2); g.fillRect(39, 48, 13, 2);
      if (window.drawChar) { drawChar(g, 18, 48, c, 'se', false, false, tt, 'caminar'); drawChar(g, 45, 48, c, 'ne', false, true, tt + 2, 'quieto'); }
    }
    var timer = setInterval(function () { if (!document.body.contains(lienzo)) { if (tt > 4) clearInterval(timer); } tt++; dibujar(); }, 140);
    function chips(etq, clave, lista) {
      return h('div.fila-campo', h('label.etiqueta-campo', etq), h('div.elegir-chips', lista.map(function (k) {
        return h('button.chip', { type: 'button', class: av[clave] === k ? 'chip sel' : 'chip', onclick: function () {
          av[clave] = k; if (clave === 'pxArriba' && k === 'vestido') av.pxAbajo = 'pantalon'; pintar(); dibujar(); } }, NOMBRE[k] || k);
      })));
    }
    function colores(etq, clave, lista) {
      return h('div.fila-campo', h('label.etiqueta-campo', etq), h('div.paleta', lista.map(function (hex) {
        return h('button', { type: 'button', class: hex === (av[clave] || '').toLowerCase() ? 'sel' : '', style: { background: hex }, title: hex,
          onclick: function () { av[clave] = hex; pintar(); dibujar(); } });
      })));
    }
    function pintar() {
      App.add(App.vaciar(controles),
        colores('Piel', 'colorPiel', PIEL),
        chips('Peinado', 'pxPelo', PELOS), colores('Color de pelo', 'colorPelo', PELO_C),
        chips('Arriba', 'pxArriba', ARRIBAS), colores('Color de arriba', 'colorTorso', ROPA),
        av.pxArriba === 'vestido' ? null : chips('Abajo', 'pxAbajo', ABAJOS),
        av.pxArriba === 'vestido' ? null : colores(av.pxAbajo === 'pollera' ? 'Color de la pollera' : av.pxAbajo === 'short' ? 'Color del short' : 'Color del pantalón', 'colorPiernas', ABAJO_C),
        chips('Accesorio', 'pxAccesorio', ACCES),
        av.pxAccesorio && av.pxAccesorio !== 'ninguno' ? colores('Color del accesorio', 'colorAccesorio', ACC_C) : null);
    }
    var azar = h('button.btn.chico', { type: 'button', onclick: function () {
      var s = Math.random().toString(36).slice(2, 10);
      av.pxPelo = pick(PELOS.slice(0, 8), s, 'a'); av.pxArriba = pick(ARRIBAS, s, 'b'); av.pxAbajo = pick(ABAJOS, s, 'c'); av.pxAccesorio = hash(s) % 6 === 0 ? pick(ACCES.slice(1), s, 'd') : 'ninguno';
      av.colorPiel = pick(PIEL, s, 'e'); av.colorPelo = pick(PELO_C, s, 'f'); av.colorTorso = pick(ROPA, s, 'g'); av.colorPiernas = pick(ABAJO_C, s, 'h'); av.colorAccesorio = pick(ACC_C, s, 'i');
      pintar(); dibujar(); } }, App.icono('dado'), 'Otro aspecto');
    pintar(); dibujar();
    var cuerpo = op.plegable ? h('details.ap-plegable', h('summary', 'Apariencia: peinado, ropa y colores'), controles) : controles;
    return { el: h('div.editor-avatar', lienzo, azar, cuerpo), valor: function () { return av; }, retratar: dibujar };
  }

  return { spec: spec, retrato: retrato, editor: editor, PELOS: PELOS, ARRIBAS: ARRIBAS, ABAJOS: ABAJOS };
})();
