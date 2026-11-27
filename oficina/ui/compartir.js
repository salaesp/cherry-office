/* Compartir hacia la Oficina (docs/plan-celular.md, fase 4). Desde cualquier app del celular, «Compartir › Oficina» con
   una foto, un PDF, un link o un texto: el service worker (sw.js) lo guarda en IndexedDB y abre #/compartir. Acá se elige:
   - mandárselo a alguien: abre una charla nueva con ese agente, con los archivos y el texto ya puestos (se revisa y se manda);
   - guardarlo en la biblioteca (los archivos de tipos que la biblioteca lee, POST /api/archivos).
   Solo en Android (iPhone no deja que una app web aparezca en Compartir). */
window.App = window.App || {};
App.Compartir = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var BIBLIOTECA = /\.(pdf|docx?|rtf|pages|odt|txt|md|csv|tsv|json|png|jpe?g|gif|webp|heic)$/i;

  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('oficina', 1);
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('compartido')) r.result.createObjectStore('compartido', { keyPath: 'id' }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(modo, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction('compartido', modo), out = fn(t.objectStore('compartido'));
        t.oncomplete = function () { res(out && 'result' in out ? out.result : undefined); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function leer() { return tx('readonly', function (s) { return s.get('ultimo'); }); }
  function borrar() { return tx('readwrite', function (s) { s.delete('ultimo'); }).catch(function () {}); }

  /* el texto que va a la charla: lo compartido (título, texto, link), sin repetir */
  function textoDe(c) {
    var partes = [];
    [c.titulo, c.texto, c.url].forEach(function (x) { x = (x || '').trim(); if (x && partes.every(function (p) { return p.indexOf(x) < 0; })) partes.push(x); });
    return partes.join('\n');
  }
  function archivosDe(c) {
    return (c.archivos || []).map(function (a) {
      try { return new File([a.datos], a.nombre, { type: a.tipo || a.datos.type || '' }); } catch (e) { return a.datos; }
    });
  }
  function base64(f) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result || ''); res(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = function () { rej(new Error('No pude leer «' + f.name + '».')); };
      fr.readAsDataURL(f);
    });
  }

  function abrir(error) {
    if (!App.E || !App.E.oficina) return;
    if (error) { App.aviso('No pude recibir lo que compartiste. Probá de nuevo.', true); return; }
    leer().then(function (c) {
      if (!c) { App.aviso('No hay nada compartido para mostrar.'); return; }
      hoja(c);
    }).catch(function () { App.aviso('No pude leer lo que compartiste.', true); });
  }

  function hoja(c) {
    var archivos = archivosDe(c), texto = textoDe(c), urls = [];
    var hj = App.hoja({ titulo: 'Compartir con la oficina', ancho: 480, alCerrar: function () { urls.forEach(function (u) { URL.revokeObjectURL(u); }); } });
    var err = h('div.error-txt');
    /* qué llegó */
    var vista = h('div.comp-vista');
    archivos.forEach(function (f) {
      var mini = null;
      if (/^image\//.test(f.type)) { var u = URL.createObjectURL(f); urls.push(u); mini = h('img', { src: u, alt: '' }); }
      vista.appendChild(h('div.adjunto', mini || App.icono('clip'), h('span', f.name), h('small', App.tam ? App.tam(f.size) : '')));
    });
    var campo = h('textarea.campo', { rows: 3, placeholder: archivos.length ? 'Agregá qué querés que haga con esto (opcional)' : 'Lo que compartiste', value: texto });

    /* a quién: la secretaría primero, después el resto */
    var sec = App.E.oficina.secretaria && App.E.oficina.secretaria.agente;
    var agentes = (App.E.oficina.agentes || []).slice().sort(function (x, y) { return (y.id === sec) - (x.id === sec); });
    var personas = h('div.comp-personas', agentes.map(function (a) {
      return h('button.comp-persona', { type: 'button', onclick: function () { mandar(a.id); } },
        App.retratoImg(a, 'retrato', 64), h('b', a.nombre), h('small', a.id === sec ? 'Secretaría' : (a.rol || '')));
    }));
    function mandar(id) {
      App.Nav.ir('#/equipo/' + encodeURIComponent(id));
      App.Agente.compartir(id, { texto: campo.value.trim(), archivos: archivos });
      borrar(); hj.cerrar();
    }

    var paraBib = archivos.filter(function (f) { return BIBLIOTECA.test(f.name); });
    var btnBib = paraBib.length ? h('button.btn', { onclick: function () {
      btnBib.disabled = true; err.textContent = '';
      var ok = 0, ya = 0, fallas = [];
      paraBib.reduce(function (p, f) {
        return p.then(function () { return base64(f); }).then(function (b64) { return App.api.post('/api/archivos', { nombre: f.name, base64: b64 }); })
          .then(function (r) { if (r.duplicado) ya++; else ok++; }).catch(function (e) { fallas.push(f.name + ': ' + e.message); });
      }, Promise.resolve()).then(function () {
        if (fallas.length && !ok && !ya) { err.textContent = 'No pude guardarlo: ' + fallas.join(' · '); btnBib.disabled = false; return; }
        var otros = archivos.length - paraBib.length;
        App.aviso((ok ? (ok === 1 ? 'Guardé 1 archivo en la biblioteca.' : 'Guardé ' + ok + ' archivos en la biblioteca.') : '') +
          (ya ? ' ' + (ya === 1 ? '1 ya estaba.' : ya + ' ya estaban.') : '') +
          (otros ? ' ' + (otros === 1 ? '1 no es de un tipo que la biblioteca lea.' : otros + ' no son de un tipo que la biblioteca lea.') : '') +
          (fallas.length ? ' No pude guardar ' + fallas.join(' · ') : ''), fallas.length > 0);
        borrar(); hj.cerrar();
      });
    } }, App.icono('libro'), paraBib.length === archivos.length ? 'Guardar en la biblioteca' : 'Guardar en la biblioteca (' + paraBib.length + ' de ' + archivos.length + ')') : null;

    App.add(hj.cuerpo,
      archivos.length ? vista : null,
      campo,
      agentes.length ? h('div.etiqueta-campo', { style: { marginTop: '14px' } }, 'Mandárselo a…') : h('p.ayuda', 'Todavía no hay nadie en la oficina.'),
      personas, err);
    App.add(hj.pie, h('button.btn.fantasma', { onclick: function () { borrar(); hj.cerrar(); } }, 'Descartar'), h('span', { style: { flex: 1 } }), btnBib);
  }

  return { abrir: abrir };
})();
