/* Muebles y objetos de la oficina pixel (v2). Se apoya en el núcleo N (nucleo.js).
   Todo se pinta con fillRect (a través de N): nada de caminos, arcos, degradés ni imágenes.
   Convención: M.nombre(x, y, o) con (x, y) = esquina mínima de la huella en el mundo.
   Los objetos con frente aceptan o.mira ∈ '+x' | '+y' | '-x' | '-y' (hacia dónde mira el frente).
   M.huella.nombre = {w, d} en baldosas, sin rotar (con mira ±x se intercambian w y d). */
(function (root) {
  const N = root.N;
  const M = {}; M.huella = {}; M.pared = {};
  const O = N.OUT, sh = (c, k) => N.shade(c, k), R = Math.round;

  /* ---------- materiales: tapa, frente (claro), costado (oscuro), contorno, brillo ---------- */
  const T = (t, l, r, o, hi) => ({ t, l, r, o, hi });
  const tono = (c, o = O, hi) => ({ t: sh(c, 1.16), l: c, r: sh(c, .76), o, hi: hi === undefined ? sh(c, 1.32) : hi });
  const MAT = {
    madera: T('#e3b57c', '#c48d55', '#a06d3d', O, '#f3d3a2'),
    maderaOsc: T('#a26a43', '#7e4f2f', '#653d23', O, '#c08a5e'),
    blanco: T('#f7f5f0', '#dcd7ce', '#c0b9ae', O, '#ffffff'),
    metal: T('#5d5f6b', '#44464f', '#35363e'),
    metalO: T('#5d5f6b', '#44464f', '#35363e', O),
    cromo: T('#d5dae1', '#aeb5bf', '#8f97a3'),
    gris: T('#d3d8df', '#b0b7c1', '#939ba7', O, '#eef1f5'),
    negro: T('#3a3c46', '#25262e', '#1c1d23', O),
    piedra: T('#eeeae3', '#cfc9bf', '#b3ada3', O, '#ffffff'),
  };
  const LIBROS = ['#e2574c', '#4a80c6', '#f2b84b', '#4fb176', '#9c88c0', '#efe9dc', '#e58a3a', '#3f5f8a', '#c0504d', '#6aa0a8', '#d7c3a0'];
  const HOJAS = ['#24603a', '#2f7d45', '#46a457', '#7fd06e'];

  /* ---------- kit de armado en coordenadas locales ----------
     u = ancho (W), v = profundidad (D); el frente está en v = D. mira rota el kit en el mundo.
     Cada pieza es una caja con huella en el mundo; al final se ordenan atrás→adelante. */
  function K(x, y, mira, W, D) {
    const m = mira || '+y';
    const toW = (u, v) => m === '-y' ? [x + W - u, y + D - v] : m === '+x' ? [x + v, y + W - u] : m === '-x' ? [x + D - v, y + u] : [x + u, y + v];
    const P = (u, v, z) => N.up(N.iso(...toW(u, v)), z || 0);
    const NR = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] };
    const wn = s => { const [a, b] = NR[s]; return m === '-y' ? [-a, -b] : m === '+x' ? [b, -a] : m === '-x' ? [-b, a] : [a, b]; };
    const wb = (u, v, w, d) => { const p = toW(u, v), q = toW(u + w, v + d); return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])]; };
    const parts = [];
    const k = { P, toW, m, W, D };
    k.vis = s => { const [a, b] = wn(s); return a > 0 || b > 0; };
    /* color de una cara a mano según hacia dónde mira en el mundo */
    k.lado = (s, mat) => wn(s)[1] > 0 ? mat.l : mat.r;
    k.box = (u, v, w, d, z, h, c, after) => { const b = wb(u, v, w, d); parts.push({ b, z, h, f: () => { N.box(b[0], b[1], b[2], b[3], z, h, c); if (after) after(); } }); return k; };
    k.fn = (u, v, w, d, z, h, f) => { parts.push({ b: wb(u, v, w, d), z, h, f }); return k; };
    k.fv = (u0, u1, v, z0, z1, c) => N.poly([P(u0, v, z0), P(u1, v, z0), P(u1, v, z1), P(u0, v, z1)], c);
    k.fu = (v0, v1, u, z0, z1, c) => N.poly([P(u, v0, z0), P(u, v1, z0), P(u, v1, z1), P(u, v0, z1)], c);
    k.top = (u0, v0, u1, v1, z, c) => N.poly([P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z)], c);
    k.ln = (a, b, c) => N.L(P(a[0], a[1], a[2]), P(b[0], b[1], b[2]), c);
    /* parámetro de una cara vertical: s 0..1 de izquierda a derecha en pantalla, t 0..1 de arriba a abajo */
    k.cara = (side, a0, a1, plane, z0, z1) => {
      const pt = (a, z) => (side === 'front' || side === 'back') ? P(a, plane, z) : P(plane, a, z);
      const flip = pt(a1, z0)[0] < pt(a0, z0)[0];
      return (s, t) => pt(flip ? a1 - (a1 - a0) * s : a0 + (a1 - a0) * s, z1 - (z1 - z0) * t);
    };
    /* la cara del frente si se ve; si no, la de atrás (para dibujar el lado que corresponde) */
    k.frenteVisible = () => k.vis('front');
    k.sombra = (u, v, w, d, a) => { const b = wb(u, v, w, d); sombra(b[0], b[1], b[2], b[3], a); };
    k.draw = () => {
      const n = parts.length, e = 1e-6;
      const bef = (A, B) => {
        const a = A.b, b = B.b;
        if (a[0] + a[2] <= b[0] + e || a[1] + a[3] <= b[1] + e) return true;
        const ov = a[0] < b[0] + b[2] - e && b[0] < a[0] + a[2] - e && a[1] < b[1] + b[3] - e && b[1] < a[1] + a[3] - e;
        return ov && A.z + A.h <= B.z + e;
      };
      const indeg = new Array(n).fill(0), adj = parts.map(() => []), used = new Array(n).fill(false);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && bef(parts[i], parts[j]) && !bef(parts[j], parts[i])) { adj[i].push(j); indeg[j]++; }
      for (let c = 0; c < n; c++) {
        let p = -1;
        for (let i = 0; i < n; i++) if (!used[i] && indeg[i] === 0) { p = i; break; }
        if (p < 0) for (let i = 0; i < n; i++) if (!used[i]) { p = i; break; }
        used[p] = true; adj[p].forEach(j => indeg[j]--); parts[p].f();
      }
    };
    return k;
  }

  /* helpers sobre una cara parametrizada S(s,t) */
  const qS = (S, s0, s1, t0, t1, c) => N.poly([S(s0, t0), S(s1, t0), S(s1, t1), S(s0, t1)], c);
  const lS = (S, s0, t0, s1, t1, c) => N.L(S(s0, t0), S(s1, t1), c);
  const pS = (S, s, t, c) => { const p = S(s, t); N.px(p[0], p[1], c); };

  /* sombra de contacto sobre el piso, corrida hacia abajo-derecha (luz de arriba a la izquierda) */
  function sombra(x, y, w, d, a) {
    N.alpha(a || .13, () => N.quad(x + .03, y + .01, x + w + .07, y + d + .05, O));
  }

  /* cilindro (macetas, puffs, tachos, mesas redondas): centro en el mundo, radio en baldosas */
  function cyl(cx, cy, r, z0, h, c, o = O) {
    const C = N.iso(cx, cy), rx = Math.max(1, R(r * 42.4)), ry = Math.max(1, R(r * 21.2));
    const X = R(C[0]), yb = R(C[1] - z0 * N.S), yt = R(C[1] - (z0 + h) * N.S);
    const ee = i => R(ry * Math.sqrt(Math.max(0, 1 - (i * i) / ((rx + .5) * (rx + .5)))));
    const hl = c.hl || sh(c.l, 1.18);
    for (let i = -rx; i <= rx; i++) {
      const e = ee(i), col = i === R(-rx * .55) ? hl : i <= R(rx * .2) ? c.l : c.r;
      N.rect(X + i, yt + e, 1, yb - yt + 1, col);
      if (o) N.px(X + i, yb + e + 1, o);
    }
    for (let i = -rx; i <= rx; i++) { const e = ee(i); N.rect(X + i, yt - e, 1, 2 * e + 1, c.t); if (o) N.px(X + i, yt - e - 1, o); }
    if (o) { N.rect(X - rx - 1, yt, 1, yb - yt + 1, o); N.rect(X + rx + 1, yt, 1, yb - yt + 1, o); }
    return { X, yt, yb, rx, ry, ee };
  }
  /* disco plano (base de lámpara, tapa de mesa alta) */
  const disco = (cx, cy, r, z, col, o) => cyl(cx, cy, r, z, 0, { t: col, l: col, r: col, hl: col }, o);

  /* hoja de planta: tallo que sale de (x0,y0) con ángulo desde la vertical (rad), largo en px y caída */
  function hoja(x0, y0, ang, len, caida, ancho, tonos) {
    const n = Math.max(4, R(len * 1.2)), pts = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const w = Math.max(1, R(ancho * Math.pow(Math.sin(Math.PI * Math.min(.98, s * .9 + .08)), .7)));
      pts.push([x0 + Math.sin(ang) * len * s, y0 - Math.cos(ang) * len * s + caida * len * s * s, w]);
    }
    for (const [x, y, w] of pts) N.rect(x - w / 2 - 1, y - 1, w + 2, 3, O);
    for (const [x, y, w] of pts) N.rect(x - w / 2, y, w, 1, tonos[1]);
    for (const [x, y, w] of pts) if (w > 1) N.rect(x - w / 2, y, Math.max(1, w - 1), 1, tonos[2]);
    for (let i = 1; i < pts.length - 1; i++) if (i % 2 === 0) { const [x, y, w] = pts[i]; if (w > 2) N.px(x - w / 2, y, tonos[3]); }
  }

  /* contenido de pantalla según el estado del agente; S(s,t) es la cara de la pantalla */
  const EST = {
    trabajando: { bg: '#a6f0bf', fg: '#2b7a49', led: '#5ccf7e' },
    pensando: { bg: '#f9dd8f', fg: '#a0700f', led: '#f2c14e' },
    herramienta: { bg: '#a9cdf7', fg: '#2f63b8', led: '#5a9cf0' },
    error: { bg: '#f59a92', fg: '#ffffff', led: '#f0564c' },
    inactivo: { bg: '#1b1d27', fg: '#5a6080', led: '#3a3d4a' },
  };
  function pantalla(S, estado, t, seed, luz) {
    const e = EST[estado] || EST.inactivo; t = t || 0; seed = seed || 0;
    let bg = e.bg;
    if (estado === 'error' && (t >> 1) % 2) bg = '#e8746b';
    qS(S, 0, 1, 0, 1, bg);
    if (estado === 'trabajando') {
      for (let i = 0; i < 4; i++) {
        const ind = ((seed + i * 3) % 3) * .1, full = .45 + ((seed * 7 + i * 5) % 5) * .08;
        const len = i === 3 ? full * (((t + seed) % 8) / 8) : full;
        if (len > .02) lS(S, .1 + ind, .18 + i * .2, .1 + ind + len * .8, .18 + i * .2, e.fg);
      }
      if (t % 2 === 0) { const p = S(.1 + (((t + seed) % 8) / 8) * .45, .78); N.px(p[0] + 1, p[1], e.fg); }
    } else if (estado === 'pensando') {
      lS(S, .12, .22, .6, .22, sh(e.bg, .85)); lS(S, .12, .4, .45, .4, sh(e.bg, .85));
      const k = (t >> 1) % 4; for (let i = 0; i < 3; i++) if (i < k) pS(S, .38 + i * .14, .7, e.fg);
    } else if (estado === 'herramienta') {
      lS(S, .12, .22, .7, .22, e.fg); lS(S, .12, .4, .5, .4, sh(e.bg, .8));
      const f = ((t + seed) % 12) / 12;
      qS(S, .12, .88, .62, .82, sh(e.bg, .8)); qS(S, .12, .12 + .76 * f, .62, .82, e.fg);
    } else if (estado === 'error') {
      lS(S, .5, .2, .5, .58, e.fg); pS(S, .5, .78, e.fg);
    } else {
      const u = ((t + seed) % 16) / 16; pS(S, .15 + u * .7, .3 + ((t >> 2) % 3) * .2, e.fg);
    }
    N.alpha(.55, () => { lS(S, .76, .08, .94, .08, '#ffffff'); pS(S, .94, .2, '#ffffff'); });
    if (luz > 0 && estado && estado !== 'inactivo') {
      const c = S(.5, .5); N.dith(c[0], c[1] + 3, 16, 10, e.bg, .22 * luz);
    }
  }

  const op = o => o || {};
  const semilla = (x, y) => Math.abs(R(x * 7.3 + y * 13.1)) % 97;

  /* =================================== TRABAJO =================================== */

  /* escritorio doble: dos puestos enfrentados, tapa blanca, separador bajo. mira ±y: largo en x */
  M.huella.escritorioDoble = { w: 1.1, d: 1.2 };
  M.escritorioDoble = (x, y, o) => {
    o = op(o); const W = 1.1, D = 1.2, k = K(x, y, (o.mira === '+x' || o.mira === '-x') ? '+x' : '+y', W, D);
    const pata = o.patas === 'madera' ? T('#c48d55', '#a87545', '#8a5e35') : MAT.metal;
    const sep = tono(o.color || '#7f9fbf');
    k.sombra(0, 0, W, D);
    [0.03, 1.02].forEach(u => {
      k.box(u, .03, .05, 1.14, 0, .6, pata);
      k.box(u, .07, .05, .05, .6, 6.6, pata); k.box(u, 1.08, .05, .05, .6, 6.6, pata);
    });
    k.box(.08, .58, .94, .04, 5.6, 1, pata);
    k.box(0, 0, W, D, 7.2, .8, MAT.blanco, () => { k.ln([.06, .6, 8], [1.04, .6, 8], '#e6e1d8'); });
    /* lo que va sobre la mitad de atrás (y o x menor) se dibuja antes del separador; la otra mitad, después */
    if (o.atras) k.fn(0, 0, W, .585, 8, .01, o.atras);
    if (o.adelante) k.fn(0, .615, W, .585, 8, .01, o.adelante);
    if (o.divisor) k.box(.05, .585, 1.0, .03, 8, 4.4, sep, () => {
      const s = k.vis('front') ? 'front' : 'back', S = k.cara(s, .05, 1.05, s === 'front' ? .615 : .585, 8, 12.4);
      lS(S, .02, .15, .98, .15, sh(sep.l, 1.15)); for (let i = 1; i < 4; i++) lS(S, i / 4, .2, i / 4, 1, sh(sep.l, .9));
    });
    k.draw();
  };

  /* escritorio individual de madera; mira = lado donde se sienta la persona */
  M.huella.escritorio = { w: 1.1, d: 0.6 };
  M.escritorio = (x, y, o) => {
    o = op(o); const W = 1.1, D = .6, k = K(x, y, o.mira, W, D), mad = o.mat === 'blanco' ? MAT.blanco : MAT.madera;
    k.sombra(0, 0, W, D);
    k.box(.03, .04, .05, .52, 0, 7.2, mad);
    k.box(.08, .06, .62, .04, 2.2, 5, T(sh(mad.t, .9), sh(mad.l, .85), sh(mad.r, .85), O));
    k.box(.7, .05, .36, .51, 0, 7.2, mad, () => {
      if (!k.vis('front')) return;
      const S = k.cara('front', .7, 1.06, .56, 0, 7.2), d = sh(mad.l, .7), hl = '#f2dcb4';
      lS(S, .06, .34, .94, .34, d); lS(S, .06, .66, .94, .66, d);
      [.17, .5, .83].forEach(t => { lS(S, .38, t, .62, t, hl); lS(S, .38, t + .06, .62, t + .06, d); });
    });
    k.box(0, 0, W, D, 7.2, .8, mad, () => {
      const r = N.rng(semilla(x, y) + 3), g = sh(mad.t, .93);
      for (let i = 0; i < 4; i++) { const v = .08 + r() * .45, u0 = .05 + r() * .4; k.ln([u0, v, 8], [u0 + .25 + r() * .35, v, 8], g); }
    });
    k.draw();
  };

  /* escritorio ejecutivo en L, madera oscura; mira = lado de la persona, ala a la derecha */
  M.huella.escritorioL = { w: 1.6, d: 1.2 };
  M.escritorioL = (x, y, o) => {
    o = op(o); const W = 1.6, D = 1.2, k = K(x, y, o.mira, W, D), mad = MAT.maderaOsc;
    k.sombra(0, 0, W, .65); k.sombra(1, .6, .6, .6);
    k.box(.03, .04, .06, .57, 0, 7.2, mad);
    k.box(.09, .05, .94, .04, 2.2, 5, T(sh(mad.t, .88), sh(mad.l, .85), sh(mad.r, .85), O));
    k.box(1.05, .05, .5, 1.1, 0, 7.2, mad, () => {
      if (k.vis('front')) {
        const S = k.cara('front', 1.05, 1.55, 1.15, 0, 7.2), d = sh(mad.l, .7), oro = '#e9c46a';
        lS(S, .05, .34, .95, .34, d); lS(S, .05, .66, .95, .66, d); lS(S, .5, .05, .5, .95, d);
        [.17, .5, .83].forEach(t => { lS(S, .2, t, .32, t, oro); lS(S, .68, t, .8, t, oro); });
      }
      if (k.vis('left')) { const S = k.cara('left', .7, 1.12, 1.05, 0, 7.2); lS(S, .05, .5, .95, .5, sh(mad.r, .8)); }
    });
    k.box(0, 0, W, .65, 7.2, .8, mad, () => {
      const r = N.rng(11), g = sh(mad.t, .9);
      for (let i = 0; i < 4; i++) { const v = .08 + r() * .5, u0 = .05 + r() * .5; k.ln([u0, v, 8], [u0 + .3 + r() * .5, v, 8], g); }
      k.top(.3, .15, .75, .45, 8, '#3f5a4a'); k.ln([.3, .45, 8], [.75, .45, 8], '#2c4034');
    });
    k.box(1, .65, .6, .55, 7.2, .8, mad, () => { const g = sh(mad.t, .9); k.ln([1.1, .85, 8], [1.45, .85, 8], g); k.ln([1.2, 1.05, 8], [1.5, 1.05, 8], g); });
    k.draw();
  };

  /* monitor sobre el escritorio (o.z = altura de apoyo, 8 por defecto) */
  /* apaisado: pantalla de ~6.5 x 4 (antes 0.42 x 7.5, quedaba más alto que ancho) */
  M.huella.monitor = { w: .54, d: .12 };
  M.monitor = (x, y, o) => {
    o = op(o); const W = .54, D = .12, z0 = o.z ?? 8, k = K(x, y, o.mira, W, D), seed = o.seed ?? semilla(x, y);
    k.box(.17, .015, .2, .09, z0, .5, MAT.metalO);
    k.box(.25, .03, .04, .03, z0 + .5, 2.5, MAT.metal);
    const marco = T('#3a3d48', '#23252e', '#1a1c23', O, '#4b4f5c');
    k.box(0, .06, W, .04, z0 + 2.5, 5.4, marco, () => {
      /* el relleno y el contorno de abajo redondean distinto y dejaban píxeles de fondo en la diagonal: se tapa con una
         línea del color de la cara, un píxel arriba del contorno */
      const v = k.vis('front') ? .1 : .06, b = [k.P(0, v, z0 + 2.5), k.P(W, v, z0 + 2.5)].sort((p, q) => p[0] - q[0]);
      N.line(b[0][0], b[0][1] - 1, b[1][0], b[1][1] - 1, marco.l);   // de izquierda a derecha, como el contorno de N.box
      k.ln([0, v, z0 + 2.5], [0, v, z0 + 7.9], O); k.ln([W, v, z0 + 2.5], [W, v, z0 + 7.9], O);
      if (k.vis('front')) {
        const S = k.cara('front', .07, W - .04, .1, z0 + 3.3, z0 + 7.2);
        pantalla(S, o.estado || 'inactivo', o.t, seed, o.luz || 0);
        const l = k.cara('front', 0, W, .1, z0 + 2.5, z0 + 7.9)(.93, .95); N.px(l[0], l[1], (EST[o.estado] || EST.inactivo).led);
      } else {
        const S = k.cara('back', .12, W - .12, .06, z0 + 3.6, z0 + 6.8);
        qS(S, 0, 1, 0, 1, '#2e3039'); lS(S, .2, .3, .8, .3, '#1c1d23'); lS(S, .2, .5, .8, .5, '#1c1d23');
      }
    });
    k.draw();
  };

  /* notebook abierta */
  M.huella.notebook = { w: .3, d: .22 };
  M.notebook = (x, y, o) => {
    o = op(o); const W = .3, D = .22, z0 = o.z ?? 8, k = K(x, y, o.mira, W, D), seed = o.seed ?? semilla(x, y);
    const cas = T('#cfd4dc', '#aab1bc', '#8d95a1', O, '#eef1f5');
    k.box(0, .07, W, .15, z0, .4, cas, () => {
      k.top(.03, .09, .27, .16, z0 + .4, '#5b616d');
      for (let v = .105; v < .16; v += .025) k.ln([.04, v, z0 + .4], [.26, v, z0 + .4], '#7d8492');
      k.top(.11, .175, .19, .21, z0 + .4, '#c3c9d2');
    });
    k.box(.0, .04, W, .03, z0, 5, cas, () => {
      if (k.vis('front')) pantalla(k.cara('front', .02, .28, .07, z0 + .9, z0 + 4.5), o.estado || 'inactivo', o.t, seed, o.luz || 0);
      else { const S = k.cara('back', .02, .28, .04, z0 + .5, z0 + 4.5); N.disc(...S(.5, .5), 1, '#eef1f5'); }
    });
    k.draw();
  };

  /* teclado y mouse */
  M.huella.tecladoMouse = { w: .4, d: .14 };
  M.tecladoMouse = (x, y, o) => {
    o = op(o); const z0 = o.z ?? 8, k = K(x, y, o.mira, .4, .14);
    k.box(0, .02, .29, .1, z0, .4, T('#eceef2', '#b9bec7', '#9aa0aa', O), () => {
      for (let v = .04; v < .11; v += .025) k.ln([.02, v, z0 + .4], [.27, v, z0 + .4], '#aeb3bd');
      k.ln([.08, .1, z0 + .4], [.2, .1, z0 + .4], '#ffffff');
    });
    k.box(.33, .04, .05, .07, z0, .5, T('#f4f5f7', '#c3c8d0', '#a4aab4', O));
    k.draw();
  };

  /* taza (o.color), con vapor si o.t */
  M.huella.taza = { w: .06, d: .06 };
  M.taza = (x, y, o) => {
    o = op(o); const z0 = o.z ?? 8, p = N.up(N.iso(x + .03, y + .03), z0), c = o.color || '#f4f4f4', X = R(p[0]), Y = R(p[1]);
    N.rect(X - 2, Y - 5, 5, 6, O); N.rect(X + 3, Y - 4, 2, 3, O);
    N.rect(X - 1, Y - 4, 3, 4, c); N.px(X + 1, Y - 4, sh(c, .82)); N.rect(X + 1, Y - 3, 1, 3, sh(c, .82));
    N.px(X + 3, Y - 3, c); N.rect(X - 1, Y - 4, 3, 1, '#6b4430');
    if (o.t !== undefined && o.vapor !== false) N.alpha(.6, () => { const f = (o.t >> 1) % 3; N.px(X - 1 + (f === 1 ? 1 : 0), Y - 7 - f, '#ffffff'); N.px(X + 1, Y - 9 - ((f + 1) % 3), '#ffffff'); });
  };

  /* pila de papeles */
  M.huella.papeles = { w: .25, d: .18 };
  M.papeles = (x, y, o) => {
    o = op(o); const z0 = o.z ?? 8, k = K(x, y, o.mira, .25, .18), hoj = T('#ffffff', '#e4e7ec', '#c9ced8', O);
    k.box(0, .01, .21, .15, z0, .6, hoj);
    k.box(.04, .03, .2, .14, z0 + .6, .3, hoj, () => { for (let i = 0; i < 4; i++) k.ln([.07, .06 + i * .025, z0 + .9], [.07 + (i % 2 ? .1 : .14), .06 + i * .025, z0 + .9], '#aab2c0'); });
    k.draw();
  };

  /* lámpara de escritorio articulada */
  M.huella.lamparaEscritorio = { w: .16, d: .16 };
  M.lamparaEscritorio = (x, y, o) => {
    o = op(o); const z0 = o.z ?? 8, c = o.color || '#3b3f4f', luz = o.luz || 0;
    const b = N.up(N.iso(x + .06, y + .1), z0), X = R(b[0]), Y = R(b[1]);
    if (luz > 0) N.dith(X + 8, Y + 1, 9, 4, '#ffe9a8', .45 * luz);
    N.rect(X - 4, Y - 2, 8, 3, O); N.rect(X - 3, Y - 1, 6, 1, sh(c, 1.2)); N.rect(X - 3, Y, 6, 1, c);
    N.line(X, Y - 2, X + 2, Y - 11, O); N.line(X + 1, Y - 2, X + 3, Y - 11, c);
    N.line(X + 2, Y - 11, X + 7, Y - 8, O); N.line(X + 2, Y - 12, X + 7, Y - 9, c);
    N.rect(X + 5, Y - 10, 6, 4, O); N.rect(X + 6, Y - 9, 4, 2, c); N.rect(X + 6, Y - 9, 2, 1, sh(c, 1.3));
    N.rect(X + 6, Y - 7, 4, 1, luz > 0 ? '#fff3c4' : '#d9c48a');
  };

  /* impresora multifunción sobre gabinete (o.z > 0 para apoyarla en un mueble, sin gabinete) */
  M.huella.impresora = { w: .55, d: .45 };
  M.impresora = (x, y, o) => {
    o = op(o); const W = .55, D = .45, z0 = o.z ?? 0, k = K(x, y, o.mira, W, D), seed = o.seed ?? 0;
    const cuerpo = T('#eef0f3', '#cdd2d9', '#aab1bb', O, '#ffffff'), gab = T('#9aa1ac', '#7d8591', '#646b76', O);
    let zb = z0;
    if (z0 === 0) {
      k.sombra(0, 0, W, D);
      k.box(.02, .02, .51, .41, 0, 6, gab, () => { if (k.vis('front')) { const S = k.cara('front', .02, .53, .43, 0, 6); lS(S, .05, .5, .95, .5, sh(gab.l, .7)); lS(S, .4, .25, .6, .25, '#c9ced6'); lS(S, .4, .75, .6, .75, '#c9ced6'); } });
      zb = 6;
    }
    k.box(0, 0, W, D, zb, 4.5, cuerpo, () => {
      if (!k.vis('front')) return;
      const S = k.cara('front', 0, W, D, zb, zb + 4.5);
      qS(S, .08, .62, .35, .6, '#3a3d48'); qS(S, .12, .58, .4, .5, '#ffffff');
      qS(S, .72, .92, .18, .45, '#3a3d48'); pS(S, .9, .7, '#5ccf7e');
    });
    k.box(.03, .03, .49, .32, zb + 4.5, 1, T('#5d626e', '#474b55', '#383b43', O, '#7a808c'));
    k.box(.36, .36, .16, .08, zb + 4.5, .6, T('#3a3d48', '#2a2c34', '#212228', O), () => { const p = k.P(.42, .4, zb + 5.1); N.px(p[0], p[1], ((o.t || 0) + seed) % 6 < 3 ? '#5ccf7e' : '#2b7a49'); });
    k.draw();
  };

  /* =================================== ASIENTOS =================================== */

  /* silla de oficina: base de 5 rayos con ruedas, pistón, asiento, respaldo y apoyabrazos */
  M.huella.sillaOficina = { w: .4, d: .4 };
  M.sillaOficina = (x, y, o) => {
    o = op(o); const W = .4, D = .4, k = K(x, y, o.mira, W, D), c = o.color || '#434a62';
    const tela = T(sh(c, 1.18), c, sh(c, .76), O, sh(c, 1.35)), tela2 = T(sh(c, 1.05), sh(c, .88), sh(c, .68), O);
    k.sombra(.04, .04, .32, .32, .16);
    k.fn(.02, .02, .36, .36, 0, 1.2, () => {
      const c0 = k.P(.2, .22, 1.1), rueda = '#17171c', pata = '#2b2b33';
      const pts = [0, 1, 2, 3, 4].map(i => { const a = i * Math.PI * 2 / 5 + .5; return k.P(.2 + Math.cos(a) * .16, .22 + Math.sin(a) * .16, .5); });
      pts.sort((a, b) => a[1] - b[1]);
      for (const p of pts) { N.line(c0[0], c0[1], p[0], p[1], pata); N.line(c0[0], c0[1] + 1, p[0], p[1] + 1, O); N.rect(p[0] - 1, p[1] + 1, 3, 2, rueda); N.px(p[0] - 1, p[1] + 1, '#4a4a55'); }
      N.rect(c0[0] - 1, c0[1] - 1, 3, 2, pata);
    });
    k.box(.18, .2, .04, .04, 1.1, 1.8, MAT.cromo);
    k.box(.04, .07, .32, .31, 2.8, 1.2, tela, () => { k.ln([.08, .3, 4], [.32, .3, 4], sh(c, 1.08)); });
    k.box(.17, .015, .06, .03, 3, 2.5, MAT.metal);
    k.box(.05, 0, .3, .055, 5, 5.2, tela, () => {
      const s = k.vis('front') ? 'front' : 'back', S = k.cara(s, .05, .35, s === 'front' ? .055 : 0, 5, 10.2);
      if (s === 'front') { qS(S, .15, .85, .18, .75, sh(c, 1.08)); lS(S, .15, .18, .85, .18, sh(c, 1.25)); }
      else { qS(S, .2, .8, .25, .7, sh(c, .85)); }
    });
    [[0, .03], [.37, .4]].forEach(([u0, u1]) => {
      k.box(u0 + .005, .24, .02, .03, 3.4, 2.6, MAT.metal);
      k.box(u0, .1, u1 - u0, .24, 6, .7, tela2);
    });
    k.draw();
  };

  /* silla de visita: patas de metal, asiento y respaldo tapizados */
  M.huella.sillaVisita = { w: .36, d: .36 };
  M.sillaVisita = (x, y, o) => {
    o = op(o); const W = .36, D = .36, k = K(x, y, o.mira, W, D), c = o.color || '#b4574a';
    const tela = T(sh(c, 1.18), c, sh(c, .76), O, sh(c, 1.32));
    k.sombra(.02, .02, .32, .32, .14);
    [[.04, .03], [.29, .03], [.04, .31], [.29, .31]].forEach(([u, v]) => k.box(u, v, .03, .03, 0, 3, MAT.metal));
    k.box(.02, .08, .32, .27, 3, 1, tela);
    k.box(.04, .02, .04, .05, 3, 2, MAT.metal); k.box(.28, .02, .04, .05, 3, 2, MAT.metal);
    k.box(.03, .015, .3, .05, 5, 6.5, tela, () => { const s = k.vis('front') ? 'front' : 'back'; const S = k.cara(s, .03, .33, s === 'front' ? .065 : .015, 5, 11.5); lS(S, .1, .2, .9, .2, sh(c, 1.15)); });
    k.draw();
  };

  /* banqueta alta redonda */
  M.huella.banqueta = { w: .26, d: .26 };
  M.banqueta = (x, y, o) => {
    o = op(o); const c = o.color || '#e2574c', cx = x + .13, cy = y + .13;
    sombra(x + .02, y + .02, .22, .22, .14);
    disco(cx, cy, .1, .2, '#3d3f48', O);
    const r = cyl(cx, cy, .085, 3, 0, { t: '#aeb5bf', l: '#aeb5bf', r: '#aeb5bf' }, null);
    for (let i = -r.rx; i <= r.rx; i++) N.px(r.X + i, r.yt - r.ee(i), '#8f97a3');
    const b = N.iso(cx, cy); N.rect(R(b[0]) - 1, R(b[1] - 7.3 * N.S), 3, R(7 * N.S), O); N.rect(R(b[0]), R(b[1] - 7.3 * N.S), 1, R(7 * N.S), '#c9ced6');
    for (let i = -r.rx; i <= r.rx; i++) N.px(r.X + i, r.yt + r.ee(i), '#d5dae1');
    cyl(cx, cy, .12, 7, 1.2, { t: sh(c, 1.15), l: c, r: sh(c, .75) });
  };

  /* sillón de dos cuerpos (o.color) */
  function sofa(x, y, o, W, n) {
    o = op(o); const D = .55, k = K(x, y, o.mira, W, D), c = o.color || '#5b7fc0';
    const tela = T(sh(c, 1.15), c, sh(c, .76), O, sh(c, 1.3)), osc = T(sh(c, .95), sh(c, .82), sh(c, .66), O, sh(c, 1.1));
    k.sombra(0, 0, W, D, .15);
    [[.03, .03], [W - .07, .03], [.03, .48], [W - .07, .48]].forEach(([u, v]) => k.box(u, v, .04, .04, 0, 1, T('#5a3c26', '#4a301e', '#3a2516')));
    k.box(.1, .12, W - .2, .42, 1, 2.4, osc);
    const cw = (W - .2) / n;
    for (let i = 0; i < n; i++) k.box(.1 + i * cw, .13, cw, .41, 3.4, 1.2, tela, () => { const S = k.vis('front') ? k.cara('front', .1 + i * cw, .1 + (i + 1) * cw, .54, 3.4, 4.6) : null; if (S) lS(S, .1, .5, .9, .5, sh(c, .9)); });
    k.box(.1, 0, W - .2, .12, 1, 7.2, tela, () => {
      if (k.vis('front')) { for (let i = 0; i < n; i++) { const S = k.cara('front', .1 + i * cw, .1 + (i + 1) * cw, .12, 4.6, 8.2); lS(S, .08, .12, .92, .12, sh(c, 1.25)); lS(S, .1, .9, .9, .9, sh(c, .85)); } }
    });
    k.box(0, 0, .1, D, 1, 4.6, tela); k.box(W - .1, 0, .1, D, 1, 4.6, tela);
    k.draw();
  }
  M.huella.sillon2 = { w: 1.2, d: .55 };
  M.sillon2 = (x, y, o) => sofa(x, y, o, 1.2, 2);
  M.huella.sillon1 = { w: .62, d: .55 };
  M.sillon1 = (x, y, o) => sofa(x, y, o, .62, 1);

  /* puff redondo (o.color) */
  M.huella.puff = { w: .3, d: .3 };
  M.puff = (x, y, o) => {
    o = op(o); const c = o.color || '#f2b84b', cx = x + .15, cy = y + .15;
    sombra(x, y, .3, .3, .15);
    const r = cyl(cx, cy, .13, 0, 4, { t: sh(c, 1.14), l: c, r: sh(c, .76) });
    N.ellipse(r.X, r.yt, r.rx - 3, r.ry - 2, sh(c, 1.24)); N.px(r.X, r.yt, sh(c, .8));
    for (let i = -r.rx; i <= r.rx; i += 3) N.px(r.X + i, R((r.yt + r.yb) / 2) + r.ee(i), sh(c, .85));
  };

  /* =================================== MESAS =================================== */

  /* mesa de reunión larga de madera (o.w × o.d) */
  M.huella.mesaReunion = { w: 2.4, d: 1.0 };
  M.mesaReunion = (x, y, o) => {
    o = op(o); const W = o.w || 2.4, D = o.d || 1.0, k = K(x, y, '+y', W, D), mad = MAT.madera, pie = MAT.maderaOsc;
    k.sombra(0, 0, W, D);
    [.28, W - .4].forEach(u => { k.box(u - .05, .15, .22, D - .3, 0, .6, pie); k.box(u, .22, .12, D - .44, .6, 6.6, pie); });
    k.box(.45, D / 2 - .03, W - .9, .06, 5, .8, pie);
    k.box(0, 0, W, D, 7.2, .8, mad, () => {
      const r = N.rng(R(W * 10 + D)), g = sh(mad.t, .93);
      for (let i = 0; i < W * 3; i++) { const v = .06 + r() * (D - .12), u0 = .05 + r() * (W - .6); k.ln([u0, v, 8], [u0 + .3 + r() * .5, v, 8], g); }
      k.top(W / 2 - .13, D / 2 - .06, W / 2 + .13, D / 2 + .06, 8, '#4a4d57'); k.top(W / 2 - .1, D / 2 - .035, W / 2 + .1, D / 2 + .035, 8, '#2f3139');
      [-.06, 0, .06].forEach(du => { const p = k.P(W / 2 + du, D / 2, 8); N.px(p[0], p[1], '#c9ced6'); });
    });
    k.draw();
  };

  /* mesa alta redonda (para banquetas) */
  M.huella.mesaAlta = { w: .6, d: .6 };
  M.mesaAlta = (x, y, o) => {
    o = op(o); const cx = x + .3, cy = y + .3, c = o.color || '#f4efe7';
    sombra(x + .1, y + .1, .4, .4, .15);
    cyl(cx, cy, .15, 0, .6, MAT.metal);
    const b = N.iso(cx, cy); N.rect(R(b[0]) - 2, R(b[1] - 10.6 * N.S), 4, R(10 * N.S), O); N.rect(R(b[0]) - 1, R(b[1] - 10.6 * N.S), 2, R(10 * N.S), '#5d5f6b'); N.rect(R(b[0]) - 1, R(b[1] - 10.6 * N.S), 1, R(10 * N.S), '#8a8d99');
    const r = cyl(cx, cy, .29, 10.6, .7, { t: c, l: sh(c, .82), r: sh(c, .68), hl: sh(c, .9) });
    for (let i = -r.rx + 2; i < -2; i++) N.px(r.X + i, r.yt - r.ee(i) + 1, '#ffffff');
  };

  /* mesa ratona con estante de revistas */
  M.huella.mesaRatona = { w: .8, d: .45 };
  M.mesaRatona = (x, y, o) => {
    o = op(o); const W = .8, D = .45, k = K(x, y, o.mira, W, D), mad = MAT.madera, pata = T('#5a3c26', '#4a301e', '#3a2516');
    k.sombra(0, 0, W, D);
    [[.02, .02], [.74, .02], [.02, .39], [.74, .39]].forEach(([u, v]) => k.box(u, v, .04, .04, 0, 3.6, pata));
    k.box(.06, .06, .68, .33, 1, .4, T(sh(mad.t, .9), sh(mad.l, .9), sh(mad.r, .9), O), () => {
      k.top(.12, .12, .34, .3, 1.4, '#4a80c6'); k.top(.16, .14, .36, .32, 1.5, '#f2b84b'); k.top(.45, .1, .62, .28, 1.4, '#e2574c');
    });
    k.box(0, 0, W, D, 3.6, .7, mad, () => { const g = sh(mad.t, .93); k.ln([.08, .15, 4.3], [.5, .15, 4.3], g); k.ln([.3, .32, 4.3], [.72, .32, 4.3], g); });
    k.draw();
  };

  /* mesa de lectura con libros */
  M.huella.mesaLectura = { w: 1.2, d: .7 };
  M.mesaLectura = (x, y, o) => {
    o = op(o); const W = 1.2, D = .7, k = K(x, y, o.mira, W, D), mad = MAT.madera, pata = MAT.maderaOsc;
    k.sombra(0, 0, W, D);
    [[.04, .04], [1.1, .04], [.04, .6], [1.1, .6]].forEach(([u, v]) => k.box(u, v, .06, .06, 0, 7.2, pata));
    k.box(.1, .06, 1.0, .03, 5.6, 1.2, pata); k.box(.1, .61, 1.0, .03, 5.6, 1.2, pata);
    k.box(0, 0, W, D, 7.2, .8, mad, () => {
      const g = sh(mad.t, .93); k.ln([.1, .2, 8], [.6, .2, 8], g); k.ln([.5, .5, 8], [1.1, .5, 8], g);
      k.top(.6, .22, .9, .44, 8, '#f7f2e6'); k.ln([.75, .22, 8], [.75, .44, 8], '#b9ad95');
      for (let i = 0; i < 3; i++) { k.ln([.63, .26 + i * .05, 8], [.72, .26 + i * .05, 8], '#c8c0ad'); k.ln([.78, .26 + i * .05, 8], [.87, .26 + i * .05, 8], '#c8c0ad'); }
    });
    k.box(.15, .35, .25, .17, 8, .8, T('#5e8fd0', '#4a80c6', '#3a68a6', O), null);
    k.box(.17, .37, .22, .14, 8.8, .7, T('#f06a5e', '#e2574c', '#b9443b', O));
    k.draw();
  };

  /* mostrador de recepción: frente alto hacia las visitas (mira), mesa baja detrás */
  M.huella.mostrador = { w: 1.6, d: .6 };
  M.mostrador = (x, y, o) => {
    o = op(o); const W = o.w || 1.6, D = .6, k = K(x, y, o.mira, W, D), mad = MAT.madera;
    k.sombra(0, 0, W, D);
    k.box(.12, .08, .05, .3, 0, 7.2, MAT.blanco);
    k.box(.1, .05, W - .2, .35, 7.2, .8, MAT.blanco);
    if (o.atras) k.fn(.1, .05, W - .2, .35, 8, .01, o.atras);
    [0, W - .1].forEach(u => k.box(u, .02, .1, .38, 0, 12, mad));
    k.box(0, .4, W, .2, 0, 12, mad, () => {
      if (k.vis('front')) {
        const S = k.cara('front', 0, W, .6, 0, 12), d = sh(mad.l, .82);
        for (let i = 1; i < W * 10; i++) lS(S, i / (W * 10), .05, i / (W * 10), .95, d);
        lS(S, 0, .97, 1, .97, sh(mad.l, .6));
      }
    });
    k.box(0, .02, .1, .34, 12, .8, MAT.blanco); k.box(W - .1, .02, .1, .34, 12, .8, MAT.blanco);
    k.box(0, .36, W, .26, 12, .8, MAT.blanco);
    k.draw();
  };

  /* =================================== GUARDADO =================================== */

  /* biblioteca llena de libros de colores (o.h alto, o.w ancho) */
  M.huella.biblioteca = { w: 1.0, d: .32 };
  M.biblioteca = (x, y, o) => {
    o = op(o); const W = o.w || 1.0, D = .32, H = o.h || 22, k = K(x, y, o.mira, W, D), mad = o.mat === 'oscura' ? MAT.maderaOsc : MAT.madera;
    k.sombra(0, 0, W, D);
    k.box(0, 0, W, D, 0, H, mad, () => {
      if (k.vis('front')) {
        const r = N.rng(o.seed ?? semilla(x, y) + 5), n = Math.max(3, R((H - 2) / 5)), hz = (H - 2.2) / n;
        const fondo = sh(mad.l, .45), tabla = mad.t, canto = sh(mad.l, .8);
        for (let i = 0; i < n; i++) {
          const z0 = 1.2 + i * hz, z1 = z0 + hz - .7;
          const S = k.cara('front', .06, W - .06, D, z0, z1);
          qS(S, 0, 1, 0, 1, fondo);
          let s = .02;
          while (s < .97) {
            const bw = (.05 + r() * .05) / W;
            if (s + bw > .98) break;
            if (r() < .08) { s += bw; continue; }
            const hb = .55 + r() * .4, col = LIBROS[Math.floor(r() * LIBROS.length)];
            if (r() < .05 && i === n - 1) {
              const p = S(s + bw, 1); N.rect(p[0] - 1, p[1] - 3, 3, 3, '#c7744a'); N.rect(p[0] - 1, p[1] - 6, 3, 3, HOJAS[2]); N.px(p[0], p[1] - 7, HOJAS[3]); s += bw * 2.2; continue;
            }
            qS(S, s, s + bw, 1 - hb, 1, col);
            lS(S, s, 1 - hb, s, 1, sh(col, 1.25));
            if (bw * W > .06) lS(S, s, 1 - hb * .6, s + bw, 1 - hb * .6, sh(col, .7));
            s += bw;
          }
          lS(S, 0, 0, 1, 0, sh(fondo, .7));
          const Sb = k.cara('front', 0, W, D, z0 - .7, z0);
          qS(Sb, 0, 1, 0, 1, canto); lS(Sb, 0, 0, 1, 0, tabla);
        }
        const St = k.cara('front', 0, W, D, H - 1, H); lS(St, 0, .9, 1, .9, sh(mad.l, .75));
      } else {
        const S = k.cara('back', 0, W, 0, 0, H);
        for (let i = 1; i < 5; i++) lS(S, i / 5, .02, i / 5, .98, sh(mad.l, .82));
      }
    });
    k.draw();
  };

  /* archivero metálico de 3 cajones */
  M.huella.archivero = { w: .42, d: .48 };
  M.archivero = (x, y, o) => {
    o = op(o); const W = .42, D = .48, k = K(x, y, o.mira, W, D), c = o.color ? tono(o.color) : MAT.gris;
    k.sombra(0, 0, W, D);
    k.box(0, 0, W, D, 0, 13, c, () => {
      if (!k.vis('front')) return;
      const S = k.cara('front', 0, W, D, 0, 13), d = sh(c.l, .72);
      [.33, .66].forEach(t => lS(S, .04, t, .96, t, d));
      [.15, .48, .81].forEach(t => { qS(S, .38, .62, t - .07, t - .01, '#ffffff'); lS(S, .36, t + .05, .64, t + .05, '#5d626e'); lS(S, .36, t + .07, .64, t + .07, sh(c.l, 1.2)); });
    });
    k.draw();
  };

  /* mueble bajo con puertas (o.w ancho) */
  M.huella.muebleBajo = { w: 1.0, d: .42 };
  M.muebleBajo = (x, y, o) => {
    o = op(o); const W = o.w || 1.0, D = .42, k = K(x, y, o.mira, W, D), mad = o.mat === 'blanco' ? MAT.blanco : MAT.madera;
    k.sombra(0, 0, W, D);
    k.box(.03, .03, W - .06, D - .05, 0, .8, T('#5a3c26', '#4a301e', '#3a2516'));
    k.box(0, 0, W, D, .8, 7.4, mad, () => {
      if (!k.vis('front')) return;
      const n = Math.max(2, R(W / .5)), S = k.cara('front', 0, W, D, .8, 8.2), d = sh(mad.l, .7);
      for (let i = 1; i < n; i++) lS(S, i / n, .08, i / n, .97, d);
      for (let i = 0; i < n; i++) { const s = (i + (i % 2 ? .18 : .82)) / n; lS(S, s, .2, s, .38, '#f2dcb4'); lS(S, s + .012, .22, s + .012, .38, d); }
      lS(S, .01, .06, .99, .06, d);
    });
    k.draw();
  };

  /* =================================== COCINA =================================== */

  /* mesada con bajo mesada y bacha (o.w largo) */
  M.huella.mesada = { w: 2.0, d: .55 };
  M.mesada = (x, y, o) => {
    o = op(o); const W = o.w || 2.0, D = .55, k = K(x, y, o.mira, W, D), mad = MAT.madera;
    k.sombra(0, 0, W, D);
    k.box(.03, .04, W - .06, .45, 0, .8, T('#5a3c26', '#4a301e', '#3a2516'));
    k.box(0, .02, W, .5, .8, 7.6, mad, () => {
      if (!k.vis('front')) return;
      const n = Math.max(2, R(W / .5)), S = k.cara('front', 0, W, .52, .8, 8.4), d = sh(mad.l, .7);
      for (let i = 1; i < n; i++) lS(S, i / n, .04, i / n, .98, d);
      for (let i = 0; i < n; i++) {
        if (i === 0) { lS(S, .01, .33, 1 / n - .01, .33, d); lS(S, .01, .66, 1 / n - .01, .66, d); [.16, .5, .83].forEach(t => lS(S, .4 / n, t, .6 / n, t, '#f2dcb4')); continue; }
        const s = (i + (i % 2 ? .15 : .85)) / n; lS(S, s, .12, s, .3, '#f2dcb4');
      }
    });
    k.box(0, 0, W, D, 8.4, .6, MAT.piedra, () => {
      const u0 = W * .62;
      k.top(u0, .12, u0 + .38, .42, 9, '#9aa3ae'); k.top(u0 + .03, .15, u0 + .35, .39, 9, '#c5ccd5'); k.top(u0 + .05, .18, u0 + .33, .37, 9, '#aab3be');
      const f = k.P(u0 + .19, .1, 9); N.rect(f[0] - 1, f[1] - 7, 2, 7, O); N.rect(f[0], f[1] - 7, 1, 6, '#d5dae1'); N.rect(f[0], f[1] - 7, 4, 1, '#d5dae1'); N.px(f[0] + 4, f[1] - 6, '#8f97a3');
    });
    k.draw();
  };

  /* cafetera de filtro (o.z = altura de la mesada, 9 por defecto) */
  M.huella.cafetera = { w: .22, d: .2 };
  M.cafetera = (x, y, o) => {
    o = op(o); const z0 = o.z ?? 9, k = K(x, y, o.mira, .22, .2), neg = T('#454852', '#2f3138', '#24252b', O, '#5d606b');
    k.box(0, .02, .22, .18, z0, .6, neg);
    k.box(0, 0, .22, .07, z0 + .6, 4.6, neg);
    k.box(.04, .09, .14, .09, z0 + .6, 2.8, T('#a0705a', '#6b4430', '#553522', O), () => {
      if (k.vis('front')) { const S = k.cara('front', .04, .18, .18, z0 + .6, z0 + 3.4); qS(S, 0, 1, 0, .35, '#cfe3ea'); lS(S, .2, .4, .2, .9, '#8c5a3e'); }
    });
    k.box(0, 0, .22, .17, z0 + 5.2, 1.4, neg, () => {
      if (k.vis('front')) { const p = k.cara('front', 0, .22, .17, z0 + 5.2, z0 + 6.6)(.8, .5); N.px(p[0], p[1], (o.t || 0) % 8 < 6 ? '#f0564c' : '#8a2a24'); }
    });
    k.draw();
    if (o.t !== undefined && (o.vapor ?? true)) { const p = k.P(.11, .13, z0 + 7.5), f = (o.t >> 1) % 3; N.alpha(.5, () => { N.px(p[0] + (f === 1), p[1] - f, '#ffffff'); N.px(p[0] - 1, p[1] - 3 - ((f + 1) % 3), '#ffffff'); }); }
  };

  /* microondas */
  M.huella.microondas = { w: .42, d: .3 };
  M.microondas = (x, y, o) => {
    o = op(o); const z0 = o.z ?? 9, k = K(x, y, o.mira, .42, .3), c = T('#e3e7ec', '#c3c9d1', '#a3aab4', O, '#f4f6f8');
    k.box(0, 0, .42, .3, z0, 4.6, c, () => {
      if (!k.vis('front')) return;
      const S = k.cara('front', 0, .42, .3, z0, z0 + 4.6);
      qS(S, .06, .66, .15, .85, '#2b2f38'); qS(S, .1, .62, .22, .78, '#3e4552');
      N.alpha(.5, () => lS(S, .14, .3, .3, .3, '#ffffff'));
      qS(S, .72, .94, .15, .32, '#1f2a24'); lS(S, .75, .23, .9, .23, '#6be08f');
      for (let i = 0; i < 3; i++) { pS(S, .76, .45 + i * .14, '#7d8591'); pS(S, .88, .45 + i * .14, '#7d8591'); }
    });
    k.draw();
  };

  /* heladera de dos puertas */
  M.huella.heladera = { w: .6, d: .6 };
  M.heladera = (x, y, o) => {
    o = op(o); const W = .6, D = .6, k = K(x, y, o.mira, W, D), c = o.color ? tono(o.color) : T('#f4f6f8', '#d7dce2', '#b8bfc8', O, '#ffffff');
    k.sombra(0, 0, W, D);
    k.box(0, 0, W, D, 0, 23, c, () => {
      if (!k.vis('front')) { const S = k.cara('back', 0, W, 0, 0, 23); qS(S, .15, .85, .45, .9, sh(c.r, .85)); for (let i = 0; i < 6; i++) lS(S, .2 + i * .12, .48, .2 + i * .12, .87, sh(c.r, .6)); return; }
      const S = k.cara('front', 0, W, D, 0, 23), d = sh(c.l, .78);
      lS(S, .02, .3, .98, .3, d); lS(S, .02, .97, .98, .97, d);
      qS(S, .86, .9, .1, .25, '#9aa1ab'); qS(S, .86, .9, .36, .6, '#9aa1ab'); lS(S, .86, .1, .86, .25, '#ffffff'); lS(S, .86, .36, .86, .6, '#ffffff');
      qS(S, .2, .28, .45, .5, '#e2574c'); qS(S, .34, .4, .55, .59, '#4a80c6'); qS(S, .18, .34, .62, .7, '#ffe066');
    });
    k.draw();
  };

  /* máquina expendedora con frente de vidrio iluminado */
  M.huella.expendedora = { w: .7, d: .6 };
  M.expendedora = (x, y, o) => {
    o = op(o); const W = .7, D = .6, k = K(x, y, o.mira, W, D), c = tono(o.color || '#c8423a'), luz = o.luz || 0;
    k.sombra(0, 0, W, D);
    k.box(0, 0, W, D, 0, 23, c, () => {
      if (!k.vis('front')) { const S = k.cara('back', 0, W, 0, 0, 23); lS(S, .1, .1, .9, .1, sh(c.r, .8)); qS(S, .2, .8, .6, .9, sh(c.r, .85)); for (let i = 0; i < 5; i++) lS(S, .25, .64 + i * .06, .75, .64 + i * .06, sh(c.r, .6)); return; }
      const S = k.cara('front', 0, W, D, 0, 23);
      qS(S, .05, .7, .1, .78, '#1d2230'); qS(S, .07, .68, .12, .76, luz > 0 ? '#e8f6ff' : '#cfe9f7');
      const cols = ['#e2574c', '#f2b84b', '#4fb176', '#4a80c6', '#9c88c0', '#e58a3a'];
      for (let r = 0; r < 5; r++) {
        const t = .2 + r * .115; lS(S, .08, t + .03, .67, t + .03, '#8a96a6');
        for (let i = 0; i < 5; i++) { const s = .12 + i * .11, col = cols[(r * 2 + i) % cols.length]; qS(S, s, s + .06, t - .045, t + .02, col); pS(S, s, t - .04, sh(col, 1.35)); }
      }
      N.alpha(.5, () => { lS(S, .1, .14, .3, .5, '#ffffff'); lS(S, .14, .14, .34, .5, '#ffffff'); });
      qS(S, .74, .95, .1, .5, '#2b2e38'); for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) pS(S, .8 + j * .08, .28 + i * .06, '#c9ced6');
      qS(S, .77, .92, .14, .2, '#6be08f'); qS(S, .82, .86, .45, .48, '#f2b84b');
      qS(S, .1, .62, .83, .93, '#1d2230'); lS(S, .1, .83, .62, .83, sh(c.l, .6));
      qS(S, .05, .95, .02, .07, sh(c.l, 1.3));
      if (luz > 0) { const p = S(.38, .45); N.dith(p[0], p[1] + 8, 20, 14, '#cfe9f7', .25 * luz); }
    });
    k.draw();
  };

  /* dispensador de agua con bidón azul */
  M.huella.dispensador = { w: .34, d: .34 };
  M.dispensador = (x, y, o) => {
    o = op(o); const W = .34, D = .34, k = K(x, y, o.mira, W, D), c = T('#f4f6f8', '#d7dce2', '#b8bfc8', O, '#ffffff');
    k.sombra(0, 0, W, D);
    k.box(0, 0, W, D, 0, 11.5, c, () => {
      if (!k.vis('front')) return;
      const S = k.cara('front', 0, W, D, 0, 11.5);
      qS(S, .15, .85, .14, .42, '#9aa3ae'); qS(S, .18, .82, .17, .4, '#6f7884');
      pS(S, .35, .2, '#e2574c'); pS(S, .65, .2, '#4a80c6'); pS(S, .35, .24, '#e2574c'); pS(S, .65, .24, '#4a80c6');
      lS(S, .2, .38, .8, .38, '#c9ced6');
      lS(S, .1, .55, .9, .55, sh(c.l, .82)); lS(S, .45, .7, .55, .7, '#9aa1ab');
    });
    k.draw();
    const cx = k.toW(.17, .17), az = { t: '#9fd3fa', l: '#6fb7f0', r: '#4f94d0', hl: '#c9e9ff' };
    N.alpha(.92, () => {
      cyl(cx[0], cx[1], .06, 11.5, 1, { t: '#4f94d0', l: '#4f94d0', r: '#3b7fc0' });
      const r = cyl(cx[0], cx[1], .13, 12.5, 7, az);
      [2.5, 5].forEach(h => { for (let i = -r.rx; i <= r.rx; i++) N.px(r.X + i, R(r.yb - h * N.S) + r.ee(i), '#4f94d0'); });
    });
  };

  /* tacho de basura (o.color) */
  M.huella.tacho = { w: .22, d: .22 };
  M.tacho = (x, y, o) => {
    o = op(o); const c = o.color || '#8d96a3', cx = x + .11, cy = y + .11;
    sombra(x, y, .22, .22, .14);
    const r = cyl(cx, cy, .095, 0, 4.4, { t: sh(c, .6), l: c, r: sh(c, .75) });
    for (let i = -r.rx; i <= r.rx; i++) N.px(r.X + i, r.yt + r.ee(i) + 1, sh(c, 1.2));
    N.ellipse(r.X, r.yt, r.rx - 1, Math.max(1, r.ry - 1), '#3a3c46');
    N.px(r.X - 1, r.yt - 1, '#f7f5f0'); N.px(r.X, r.yt - 1, '#ffffff'); N.px(r.X, r.yt - 2, '#dcd7ce');
  };

  /* =================================== JUEGOS =================================== */

  /* mesa de ping-pong; mira ±x la gira (largo en y) */
  M.huella.pingpong = { w: 1.5, d: .85 };
  M.pingpong = (x, y, o) => {
    o = op(o); const W = 1.5, D = .85, k = K(x, y, (o.mira === '+x' || o.mira === '-x') ? '+x' : '+y', W, D);
    const verde = T('#3a9a64', '#2a7a4e', '#1f6140', O);
    k.sombra(0, 0, W, D);
    [[.12, .1], [1.32, .1], [.12, .69], [1.32, .69]].forEach(([u, v]) => k.box(u, v, .05, .05, 0, 7, MAT.metal));
    k.box(.17, .4, 1.15, .05, 4.5, .8, MAT.metal);
    k.box(0, 0, W, D, 7, .6, verde, () => {
      const z = 7.6, b = '#f4f4f4', e = .03;
      k.ln([e, e, z], [W - e, e, z], b); k.ln([e, D - e, z], [W - e, D - e, z], b); k.ln([e, e, z], [e, D - e, z], b); k.ln([W - e, e, z], [W - e, D - e, z], b);
      k.ln([e, D / 2, z], [W - e, D / 2, z], b);
      const p = k.P(.35, .3, z); N.rect(p[0] - 2, p[1] - 1, 4, 3, O); N.rect(p[0] - 1, p[1], 3, 1, '#e2574c'); N.px(p[0] + 2, p[1] + 1, '#8a5a3a');
      const q = k.P(1.1, .6, z); N.rect(q[0] - 2, q[1] - 1, 4, 3, O); N.rect(q[0] - 1, q[1], 3, 1, '#3a3c46'); N.px(q[0] + 2, q[1] + 1, '#8a5a3a');
      const bl = k.P(.95, .25, z + 3); N.px(bl[0], bl[1], '#ffffff');
    });
    k.box(.745, -.04, .01, D + .08, 7.6, 1.8, T('#ffffff', '#ffffff', '#ffffff'), () => {
      const S = k.cara(k.vis('left') ? 'left' : 'right', -.04, D + .04, .745, 7.6, 9.4);
      qS(S, 0, 1, .2, 1, '#3d4250'); N.alpha(.6, () => { for (let s = .05; s < 1; s += .08) lS(S, s, .25, s, .95, '#9aa1ab'); });
      lS(S, 0, .1, 1, .1, '#ffffff');
    });
    k.draw();
  };

  /* máquina arcade con pantalla animada (o.t) y marquesina iluminada */
  M.huella.arcade = { w: .5, d: .5 };
  M.arcade = (x, y, o) => {
    o = op(o); const W = .5, D = .5, k = K(x, y, o.mira, W, D), c = tono(o.color || '#3a3f8f'), t = o.t || 0, luz = o.luz || 0;
    k.sombra(0, 0, W, D);
    k.box(0, .02, W, .46, 0, 8.5, c, () => {
      if (k.vis('front')) { const S = k.cara('front', 0, W, .48, 0, 8.5); qS(S, .35, .65, .35, .7, '#22243a'); pS(S, .42, .48, '#f2b84b'); pS(S, .58, .48, '#f2b84b'); lS(S, .05, .05, .95, .05, sh(c.l, 1.3)); }
      ['left', 'right'].forEach(s => { if (!k.vis(s)) return; const S = k.cara(s, .02, .48, s === 'left' ? 0 : W, 0, 8.5); lS(S, .1, .9, .9, .2, '#f2b84b'); lS(S, .1, .95, .9, .25, '#e2574c'); });
    });
    k.box(.02, .3, W - .04, .17, 8.5, 1.2, T('#2e3150', '#23253d', '#1b1d30', O), () => {
      const p = k.P(.15, .38, 9.7); N.rect(p[0], p[1] - 4, 1, 4, '#2a2a33'); N.rect(p[0] - 1, p[1] - 6, 3, 3, '#e2574c'); N.px(p[0] - 1, p[1] - 6, '#ff9a8f');
      [[.3, .36, '#4fb176'], [.38, .4, '#f2b84b'], [.3, .43, '#4a80c6']].forEach(([u, v, cc]) => { const q = k.P(u, v, 9.7); N.rect(q[0], q[1] - 1, 2, 1, cc); });
    });
    k.box(0, .02, W, .28, 8.5, 10.5, c, () => {
      ['left', 'right'].forEach(s => { if (!k.vis(s)) return; const S = k.cara(s, .02, .3, s === 'left' ? 0 : W, 8.5, 19); lS(S, .2, .95, .8, .1, '#f2b84b'); });
      if (!k.vis('front')) {
        const S = k.cara('back', .08, W - .08, .02, 9, 18), d = sh(c.l, .7);
        qS(S, .2, .8, .1, .45, d); for (let i = 0; i < 4; i++) lS(S, .28, .16 + i * .08, .72, .16 + i * .08, sh(c.l, .55));
        pS(S, .5, .7, '#f2b84b'); return;
      }
      const S0 = k.cara('front', 0, W, .3, 9.5, 18.5); qS(S0, .06, .94, 0, 1, '#14151f');
      const S = k.cara('front', .06, W - .06, .3, 10.4, 17.6), bg = '#0d0f1a';
      qS(S, 0, 1, 0, 1, bg);
      const off = ((t >> 1) % 6) / 30, inv = ['#6be08f', '#f06ab0', '#f2c14e'];
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) { const p = S(.12 + i * .18 + off, .14 + r * .16); N.rect(p[0], p[1], 2, 1, inv[r]); if ((t + i) % 4 < 2) N.px(p[0] - (r % 2), p[1] + 1, inv[r]); }
      const sx = .5 + Math.sin(t * .4) * .3, pl = S(sx, .86); N.rect(pl[0] - 1, pl[1], 3, 1, '#7fd0ff'); N.px(pl[0], pl[1] - 1, '#7fd0ff');
      const bt = S(sx, .86 - ((t % 6) / 6) * .6); N.px(bt[0], bt[1] - 2, '#ffffff');
      if (luz > 0) { const p = S(.5, .5); N.dith(p[0], p[1] + 4, 12, 8, '#7fd0ff', .25 * luz); }
    });
    k.box(0, 0, W, .36, 19, 2.4, T(sh(c.t, 1.1), c.l, c.r, O), () => {
      if (!k.vis('front')) return;
      const S = k.cara('front', .02, W - .02, .36, 19.3, 21.1), on = (t >> 2) % 2;
      qS(S, 0, 1, 0, 1, on ? '#ffe27a' : '#f2c14e'); lS(S, .15, .5, .85, .5, '#e2574c'); pS(S, .1, .5, '#e2574c'); pS(S, .9, .5, '#e2574c');
      if (luz > 0) { const p = S(.5, 1); N.dith(p[0], p[1] + 2, 9, 3, '#ffe27a', .3 * luz); }
    });
    k.draw();
  };

  /* =================================== DECO =================================== */

  /* planta en maceta: o.tipo = chica | mediana | alta; o.maceta color */
  M.huella.planta = { w: .35, d: .35 };
  M.huella.plantaChica = { w: .25, d: .25 };
  M.huella.plantaAlta = { w: .45, d: .45 };
  M.planta = (x, y, o) => {
    o = op(o); const tipo = o.tipo || 'mediana', hw = tipo === 'chica' ? .125 : tipo === 'alta' ? .225 : .175, cx = x + hw, cy = y + hw;
    const mac = o.maceta || (tipo === 'chica' ? '#c7744a' : '#f2efe9');
    const r = N.rng(o.seed ?? semilla(x, y) + 17);
    sombra(cx - hw * .7, cy - hw * .7, hw * 1.4, hw * 1.4, .15);
    const rp = tipo === 'chica' ? .08 : tipo === 'alta' ? .14 : .11, hp = tipo === 'chica' ? 3.2 : tipo === 'alta' ? 6.4 : 5.2;
    const pot = cyl(cx, cy, rp, 0, hp, { t: sh(mac, .8), l: mac, r: sh(mac, .8), hl: sh(mac, 1.15) });
    N.ellipse(pot.X, pot.yt, pot.rx - 1, Math.max(1, pot.ry - 1), '#5a3c26');
    for (let i = -pot.rx; i <= pot.rx; i++) N.px(pot.X + i, pot.yt + pot.ee(i) + 1, sh(mac, 1.15));
    const X = pot.X, Y = pot.yt;
    if (tipo === 'chica') {
      const hj = [[-1.1, 5, .25], [1.1, 5, .25], [-.6, 6, .1], [.6, 6, .1], [0, 7, 0], [-.25, 5, .05], [.3, 5, .05]];
      hj.forEach(([a, l, c]) => hoja(X, Y, a, l, c, 3, HOJAS));
    } else if (tipo === 'mediana') {
      /* arbusto frondoso: hojas que se abren y caen, las de atrás primero */
      const n = 14, hj = [];
      for (let i = 0; i < n; i++) { const a = -1.45 + 2.9 * (i / (n - 1)) + (r() - .5) * .25; hj.push([a, 10 + r() * 5 - Math.abs(a) * 1.5, .3 + Math.abs(a) * .25 + r() * .1]); }
      const orden = hj.map((h, i) => [h, (i * 7) % n]).sort((p, q) => p[1] - q[1]).map(p => p[0]);
      orden.slice(0, 7).forEach(([a, l, c]) => hoja(X + (a > 0 ? 1 : -1), Y - 2, a * .85, l + 2, c * .7, 4, [O, HOJAS[0], HOJAS[1], HOJAS[2]]));
      orden.slice(7).forEach(([a, l, c]) => hoja(X, Y, a, l, c, 4, HOJAS));
      [[-.5, 7, .9], [.55, 7, .9], [0, 6, .6]].forEach(([a, l, c]) => hoja(X, Y + 1, a, l, c, 4, HOJAS));
    } else {
      /* planta alta: hojas largas y paradas que se arquean en la punta */
      const n = 12, hj = [];
      for (let i = 0; i < n; i++) { const a = -.85 + 1.7 * (i / (n - 1)) + (r() - .5) * .12; hj.push([a, 30 + r() * 8 - Math.abs(a) * 12, .1 + Math.abs(a) * .35 + r() * .05]); }
      const orden = hj.map((h, i) => [h, (i * 5) % n]).sort((p, q) => p[1] - q[1]).map(p => p[0]);
      orden.slice(0, 6).forEach(([a, l, c]) => hoja(X + R(a * 2), Y - 1, a * .9, l + 2, c, 4, [O, HOJAS[0], HOJAS[1], HOJAS[2]]));
      orden.slice(6).forEach(([a, l, c]) => hoja(X + R(a * 2), Y, a, l, c, 4, HOJAS));
      [[-1.2, 10, .55], [1.2, 10, .55], [-.3, 9, .7], [.35, 9, .7]].forEach(([a, l, c]) => hoja(X, Y + 1, a, l, c, 4, HOJAS));
    }
  };

  /* lámpara colgante: cordón hasta o.zTecho, pantalla con borde en o.z; brilla con o.luz */
  M.huella.lamparaColgante = { w: .3, d: .3 };
  M.lamparaColgante = (x, y, o) => {
    o = op(o); const zT = o.zTecho ?? 40, z = o.z ?? 24, luz = o.luz || 0, c = o.color || '#2b2d36';
    const f = N.iso(x + .15, y + .15), X = R(f[0]), Yb = R(f[1] - z * N.S), Yt = R(f[1] - zT * N.S);
    if (luz > 0) {
      N.alpha(.07 * luz, () => { for (let yy = Yb + 2; yy < f[1]; yy++) { const w = R(6 + (yy - Yb) * .55); N.rect(X - w, yy, w * 2 + 1, 1, '#ffe9b0'); } });
      N.dith(X, R(f[1]), 18, 9, '#ffe9b0', .3 * luz);
    }
    N.rect(X - 2, Yt, 5, 2, O); N.rect(X - 1, Yt, 3, 1, '#5d5f6b');
    N.rect(X, Yt + 2, 1, Yb - 7 - Yt - 2, O);
    const forma = [[2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1]];
    forma.forEach(([w], i) => { const yy = Yb - 7 + i; N.rect(X - w - 1, yy, w * 2 + 3, 1, O); N.rect(X - w, yy, w * 2 + 1, 1, c); N.px(X - w + 1, yy, sh(c, 1.5)); N.rect(X + w - 1, yy, 1, 1, sh(c, .7)); });
    N.rect(X - 9, Yb, 19, 1, O);
    N.rect(X - 8, Yb, 17, 1, luz > 0 ? '#fff3c4' : '#e8c66a');
    N.rect(X - 4, Yb + 1, 9, 1, luz > 0 ? '#fff8dc' : '#d9b65a');
    if (luz > 0) N.dith(X, Yb + 3, 10, 4, '#fff3c4', .5 * luz);
  };

  /* lámpara de pie */
  M.huella.lamparaPie = { w: .3, d: .3 };
  M.lamparaPie = (x, y, o) => {
    o = op(o); const cx = x + .15, cy = y + .15, luz = o.luz || 0;
    sombra(x + .06, y + .06, .18, .18, .15);
    if (luz > 0) { const f = N.iso(cx, cy); N.dith(f[0], f[1], 16, 8, '#ffe9b0', .3 * luz); }
    disco(cx, cy, .08, .4, '#3a3c46', O);
    const f = N.iso(cx, cy), X = R(f[0]);
    N.rect(X - 1, R(f[1] - 15 * N.S), 3, R(14.6 * N.S), O); N.rect(X, R(f[1] - 15 * N.S), 1, R(14.6 * N.S), '#8a8d99');
    const s = cyl(cx, cy, .1, 14.5, 4, { t: '#fff6dc', l: luz > 0 ? '#fff1c8' : '#f3e6c8', r: luz > 0 ? '#f6dfa0' : '#d9c8a2', hl: '#ffffff' });
    N.ellipse(s.X, s.yt, s.rx - 1, Math.max(1, s.ry - 1), luz > 0 ? '#fff3c4' : '#c9b48a');
    if (luz > 0) N.dith(s.X, R((s.yt + s.yb) / 2), 12, 9, '#fff3c4', .4 * luz);
  };

  /* felpudo de entrada */
  M.huella.felpudo = { w: .8, d: .5 };
  M.felpudo = (x, y, o) => {
    o = op(o); const sw = o.mira === '+x' || o.mira === '-x', w = sw ? .5 : .8, d = sw ? .8 : .5, c = o.color || '#4a4f5a';
    N.quad(x, y, x + w, y + d, sh(c, .7)); N.quad(x + .04, y + .04, x + w - .04, y + d - .04, c);
    N.quad(x + .1, y + .1, x + w - .1, y + d - .1, sh(c, 1.15));
    for (let i = 1; i < 6; i++) { if (sw) { const yy = y + .1 + (d - .2) * i / 6; N.L(N.iso(x + .1, yy), N.iso(x + w - .1, yy), c); } else { const xx = x + .1 + (w - .2) * i / 6; N.L(N.iso(xx, y + .1), N.iso(xx, y + d - .1), c); } }
  };

  /* alfombra con borde y dibujo sutil */
  M.alfombra = (x0, y0, x1, y1, o) => {
    o = op(o); const c = o.color || '#5b7fc0', b = .14;
    N.quad(x0, y0, x1, y1, sh(c, .62));
    N.quad(x0 + .03, y0 + .03, x1 - .03, y1 - .03, sh(c, .82));
    N.quad(x0 + b, y0 + b, x1 - b, y1 - b, sh(c, 1.18));
    N.quad(x0 + b + .03, y0 + b + .03, x1 - b - .03, y1 - b - .03, c);
    const p = sh(c, 1.08);
    for (let xx = Math.ceil((x0 + b + .3) * 2) / 2; xx < x1 - b - .2; xx += .5) for (let yy = Math.ceil((y0 + b + .3) * 2) / 2; yy < y1 - b - .2; yy += .5) {
      const q = N.iso(xx, yy); N.rect(q[0] - 2, q[1], 5, 1, p); N.rect(q[0], q[1] - 1, 1, 3, p);
    }
    N.alpha(.5, () => { N.L(N.iso(x0 + .03, y1 - .03), N.iso(x1 - .03, y1 - .03), sh(c, 1.3)); });
  };
  M.huella.alfombra = { w: 3, d: 2 };

  /* TV sobre pie con ruedas */
  M.huella.tvPie = { w: .9, d: .35 };
  M.tvPie = (x, y, o) => {
    o = op(o); const W = .9, D = .35, k = K(x, y, o.mira, W, D), t = o.t || 0;
    k.sombra(.05, 0, W - .1, D);
    [.14, .7].forEach(u => { k.box(u, .02, .06, .31, 0, .7, MAT.metalO); k.box(u + .01, .12, .04, .04, .7, 9, MAT.metal); });
    k.box(.14, .12, .62, .04, 3, .6, MAT.metal);
    k.box(0, .17, W, .05, 7.5, 11, T('#3a3d48', '#1f2128', '#18191f', O, '#4b4f5c'), () => {
      if (!k.vis('front')) { const S = k.cara('back', .2, .7, .17, 9.5, 16.5); qS(S, 0, 1, 0, 1, '#2a2c34'); return; }
      const S = k.cara('front', .03, W - .03, .22, 8.2, 17.8);
      qS(S, 0, 1, 0, 1, '#f4f7fb');
      qS(S, 0, 1, 0, .18, '#4a80c6'); lS(S, .06, .09, .4, .09, '#ffffff');
      const hs = [.35, .55, .45, .75, .6]; hs.forEach((h, i) => { const s = .1 + i * .12, hh = h * (.8 + .2 * Math.sin(t * .3 + i)); qS(S, s, s + .07, .92 - hh * .65, .92, ['#4a80c6', '#4fb176', '#f2b84b', '#e2574c', '#9c88c0'][i]); });
      lS(S, .74, .3, .94, .3, '#aab2c0'); lS(S, .74, .45, .9, .45, '#aab2c0'); lS(S, .74, .6, .93, .6, '#aab2c0');
      N.alpha(.5, () => lS(S, .8, .05, .97, .05, '#ffffff'));
      if (o.luz > 0) { const p = S(.5, .5); N.dith(p[0], p[1] + 6, 24, 14, '#dfe9ff', .2 * o.luz); }
    });
    k.draw();
  };

  /* =================================== PARED ===================================
     orient 'x': pared a lo largo de x en y = wall (cara visible hacia +y).
     orient 'y': pared a lo largo de y en x = wall (cara visible hacia +x).
     u0 = comienzo sobre la pared, z0 = altura del borde inferior. */
  const E = .03;
  function placa(orient, u0, wall, w, z0, h, c, e) {
    e = e ?? E;
    if (orient === 'x') N.box(u0, wall, w, e, z0, h, c); else N.box(wall, u0, e, w, z0, h, c);
    return frente(orient, u0, wall + e, w, z0, h);
  }
  /* cara frontal de una placa sobre la pared: S(s,t) con s izq→der en pantalla, t arriba→abajo */
  function frente(orient, u0, plano, w, z0, h) {
    return (s, t) => orient === 'x' ? N.up(N.iso(u0 + w * s, plano), z0 + h * (1 - t)) : N.up(N.iso(plano, u0 + w * (1 - s)), z0 + h * (1 - t));
  }
  /* pinta los píxeles cuya posición sobre el plano de la pared cumple fn(u, z) → color */
  function sobrePared(orient, plano, u0, u1, z0, z1, fn) {
    const a = orient === 'x' ? [N.iso(u0, plano), N.iso(u1, plano)] : [N.iso(plano, u0), N.iso(plano, u1)];
    const xs = [a[0][0], a[1][0]], ys = [a[0][1], a[1][1]];
    const X0 = Math.floor(Math.min(...xs)), X1 = Math.ceil(Math.max(...xs)), Y0 = Math.floor(Math.min(...ys) - z1 * N.S), Y1 = Math.ceil(Math.max(...ys) - z0 * N.S);
    for (let sy = Y0; sy <= Y1; sy++) for (let sx = X0; sx <= X1; sx++) {
      const px = sx + .5, py = sy + .5;
      const u = orient === 'x' ? (px - N.OX) / 30 + plano : plano - (px - N.OX) / 30;
      const zz = (N.OY + (orient === 'x' ? (u + plano) : (plano + u)) * 15 - py) / N.S;
      const col = fn(u, zz); if (col) N.px(sx, sy, col);
    }
  }

  /* pizarra blanca con un gráfico chico */
  M.pared.pizarra = (orient, u0, wall, z0, o) => {
    o = op(o); const w = o.w || 1.4, h = o.h || 9;
    const S = placa(orient, u0, wall, w, z0, h, T('#e4e8ee', '#c3c9d1', '#a8afb9', O));
    qS(S, .03, .97, .06, .94, '#ffffff');
    lS(S, .1, .2, .1, .82, '#5d626e'); lS(S, .1, .82, .55, .82, '#5d626e');
    [[.16, .35, '#4a80c6'], [.25, .5, '#4fb176'], [.34, .3, '#4a80c6'], [.43, .6, '#4fb176']].forEach(([s, hh, c]) => qS(S, s, s + .05, .82 - hh, .82, c));
    [[.62, .7], [.7, .5], [.78, .58], [.86, .3]].reduce((p, q) => { lS(S, p[0], p[1], q[0], q[1], '#e2574c'); return q; });
    lS(S, .6, .18, .8, .18, '#9aa1ab'); lS(S, .6, .26, .74, .26, '#9aa1ab');
    const B = placa(orient, u0 + w * .2, wall, w * .6, z0 - .6, .6, T('#c3c9d1', '#a8afb9', '#8f97a3', O), .07);
    pS(B, .2, 0, '#e2574c'); pS(B, .25, 0, '#e2574c'); pS(B, .4, 0, '#4a80c6'); pS(B, .45, 0, '#4a80c6');
  };

  /* corcho con notas */
  M.pared.corcho = (orient, u0, wall, z0, o) => {
    o = op(o); const w = o.w || 1.0, h = o.h || 8;
    const S = placa(orient, u0, wall, w, z0, h, MAT.madera);
    qS(S, .04, .96, .07, .93, '#c99a63');
    const r = N.rng(R(u0 * 10 + wall * 3) + 9);
    for (let i = 0; i < w * 40; i++) pS(S, .06 + r() * .88, .1 + r() * .8, '#b3844f');
    const notas = ['#ffe066', '#ff9ab0', '#9fd3fa', '#b6e88f', '#ffffff', '#ffe066'];
    for (let i = 0; i < 6; i++) {
      const s = .08 + (i % 3) * .3 + r() * .05, t = .14 + Math.floor(i / 3) * .4 + r() * .06, c = notas[i];
      qS(S, s, s + .18, t, t + .3, c); lS(S, s, t + .3, s + .18, t + .3, sh(c, .8));
      lS(S, s + .03, t + .12, s + .14, t + .12, sh(c, .7)); lS(S, s + .03, t + .2, s + .1, t + .2, sh(c, .7));
      pS(S, s + .09, t + .03, i % 2 ? '#e2574c' : '#4a80c6');
    }
  };

  /* cuadro enmarcado (o.color tiñe el paisaje) */
  M.pared.cuadro = (orient, u0, wall, z0, o) => {
    o = op(o); const w = o.w || .5, h = o.h || 6, c = o.color || '#7fb3d9';
    const S = placa(orient, u0, wall, w, z0, h, MAT.maderaOsc);
    qS(S, .08, .92, .08, .92, '#f4efe4');
    qS(S, .16, .84, .16, .84, sh(c, 1.35));
    N.poly([S(.16, .84), S(.16, .55), S(.4, .38), S(.62, .58), S(.84, .45), S(.84, .84)], sh(c, .7));
    N.poly([S(.16, .84), S(.16, .7), S(.5, .6), S(.84, .72), S(.84, .84)], sh(c, .5));
    const p = S(.68, .3); N.rect(p[0] - 1, p[1] - 1, 2, 2, '#ffe066');
  };

  /* reloj de pared con la hora real */
  M.pared.reloj = (orient, u0, wall, z0, o) => {
    o = op(o); const rr = o.r || .23, uc = u0 + rr, zc = z0 + rr * 13.4, rz = rr * 13.4, pl = wall + .02;
    const dd = (u, z) => ((u - uc) / rr) ** 2 + ((z - zc) / rz) ** 2;
    sobrePared(orient, wall, uc - rr - .1, uc + rr + .1, zc - rz - 2, zc + rz + 1, (u, z) => dd(u + (orient === 'x' ? -.04 : .04), z + .5) <= 1 ? 'rgba(42,31,46,0.22)' : null);
    sobrePared(orient, pl, uc - rr - .05, uc + rr + .05, zc - rz - 1, zc + rz + 1, (u, z) => { const d = dd(u, z); return d <= .62 ? '#ffffff' : d <= .82 ? '#e2574c' : d <= 1 ? O : null; });
    const S = (a, f) => orient === 'x' ? N.up(N.iso(uc + Math.sin(a) * rr * f, pl), zc + Math.cos(a) * rz * f) : N.up(N.iso(pl, uc - Math.sin(a) * rr * f), zc + Math.cos(a) * rz * f);
    for (let i = 0; i < 4; i++) { const p = S(i * Math.PI / 2, .62); N.px(p[0], p[1], '#5d626e'); }
    const d = o.fecha || new Date(), hA = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, mA = d.getMinutes() / 60 * Math.PI * 2;
    const c0 = S(0, 0); N.L(c0, S(hA, .38), O); N.L(c0, S(mA, .58), '#3a3c46'); N.px(c0[0], c0[1], '#e2574c');
  };

  /* TV de pared */
  M.pared.tv = (orient, u0, wall, z0, o) => {
    o = op(o); const w = o.w || 1.0, h = o.h || 6.5, t = o.t || 0;
    const S = placa(orient, u0, wall, w, z0, h, T('#3a3d48', '#1f2128', '#18191f', O), .04);
    const sc = (s, tt) => S(.03 + .94 * s, .06 + .88 * tt);
    const esc = !((t >> 4) % 2);
    qS(sc, 0, 1, 0, 1, esc ? '#1e3a5f' : '#1d2436');
    if (esc) { lS(sc, .1, .25, .6, .25, '#ffffff'); lS(sc, .1, .45, .45, .45, '#9fc3ea'); lS(sc, .1, .6, .5, .6, '#9fc3ea'); N.disc(...sc(.78, .5), 2, '#f2b84b'); }
    else { [.4, .7, .55, .85].forEach((hh, i) => qS(sc, .12 + i * .14, .2 + i * .14, .9 - hh * .7, .9, ['#4a80c6', '#4fb176', '#f2b84b', '#e2574c'][i])); lS(sc, .72, .3, .92, .3, '#aab2c0'); lS(sc, .72, .5, .88, .5, '#aab2c0'); }
    N.alpha(.45, () => lS(sc, .78, .06, .96, .06, '#ffffff'));
    pS(S, .5, .97, '#f0564c');
    if (o.luz > 0) { const p = sc(.5, .5); N.dith(p[0], p[1] + 8, 22, 12, '#dfe9ff', .2 * o.luz); }
  };

  /* puerta de madera con marco (o.abierta la muestra abierta hacia el cuarto) */
  M.pared.puerta = (orient, u0, wall, z0, o) => {
    o = op(o); const w = o.w || .9, h = o.h || 16, mad = MAT.madera, z = z0 || 0;
    const marco = T('#f1e6d2', '#e2d3b8', '#c9b898', O);
    placa(orient, u0 - .05, wall, w + .1, z, h + .9, marco, .02);
    const Sf = frente(orient, u0, wall + .021, w, z, h);
    if (o.abierta) {
      qS(Sf, 0, 1, 0, 1, '#2c2430'); qS(Sf, 0, 1, .85, 1, '#3d3340');
      if (orient === 'x') N.box(u0 + .02, wall + .02, .05, w * .92, z, h - .2, mad); else N.box(wall + .02, u0 + w - .07, w * .92, .05, z, h - .2, mad);
      return;
    }
    const S = placa(orient, u0, wall, w, z, h, T('#c48d55', '#b07a45', '#93633a', O), .025);
    const d = sh(mad.l, .72);
    [[.12, .88, .07, .45], [.12, .88, .53, .93]].forEach(([s0, s1, t0, t1]) => { qS(S, s0, s1, t0, t1, sh(mad.l, .9)); lS(S, s0, t0, s1, t0, d); lS(S, s0, t0, s0, t1, d); lS(S, s0, t1, s1, t1, sh(mad.l, 1.15)); lS(S, s1, t0, s1, t1, sh(mad.l, 1.15)); });
    const hdl = S(.84, .5); N.rect(hdl[0] - 1, hdl[1] - 1, 3, 3, O); N.rect(hdl[0], hdl[1], 2, 1, '#e9c46a'); N.px(hdl[0], hdl[1] - 1, '#fff0b0');
  };

  /* puerta de vidrio de entrada, doble hoja */
  M.pared.puertaVidrio = (orient, u0, wall, z0, o) => {
    o = op(o); const w = o.w || 1.2, h = o.h || 16.5, z = z0 || 0, met = T('#5b616d', '#3d434d', '#2f343c', O);
    placa(orient, u0 - .05, wall, w + .1, z, h + 1, met, .02);
    const S = frente(orient, u0, wall + .022, w, z, h);
    qS(S, 0, 1, 0, 1, '#2f343c');
    [[.04, .48], [.52, .96]].forEach(([s0, s1]) => {
      N.alpha(.85, () => qS(S, s0, s1, .03, .97, '#bfe3f2'));
      N.alpha(.55, () => { lS(S, s0 + .05, .45, s0 + .3, .1, '#ffffff'); lS(S, s0 + .1, .5, s0 + .35, .15, '#ffffff'); lS(S, s0 + .15, .85, s0 + .4, .55, '#ffffff'); });
    });
    lS(S, .43, .35, .43, .65, '#d5dae1'); lS(S, .57, .35, .57, .65, '#d5dae1');
    lS(S, .44, .35, .44, .65, '#8f97a3'); lS(S, .56, .35, .56, .65, '#8f97a3');
    qS(S, .2, .32, .25, .3, '#4fb176');
  };

  /* huella ya rotada según mira, para el armado */
  M.huellaDe = (nombre, o) => { const h = M.huella[nombre] || { w: 1, d: 1 }; const w = (o && o.w) || h.w, d = (o && o.d) || h.d; return (o && (o.mira === '+x' || o.mira === '-x')) ? { w: d, d: w } : { w, d }; };

  M.cyl = cyl; M.sombra = sombra; M.pantalla = pantalla; M.K = K;
  root.M = M;
})(typeof window !== 'undefined' ? window : globalThis);
