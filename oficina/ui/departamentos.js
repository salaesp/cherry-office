/* Departamentos: cada uno es una sala del edificio. Crear, renombrar, cambiar color y borrar (moviendo a su gente).
   Se abre desde nav.js (modo «departamentos», ruta #/equipo/departamentos), la paleta de comandos y el menú de la app.
   Llama a /api/departamentos (POST, PATCH, DELETE): rutas en backend/src/rutas-departamentos.ts, reglas en
   backend/src/departamentos.ts, contrato en backend/API.md#departamentos. */
(function () {
  'use strict';
  var h = App.h, api = App.api;

  App.Departamentos = {
    /* `crear` (opcional) reemplaza a App.hoja: la ventana de Ajustes lo usa para dibujar la sección adentro */
    abrir: function (crear) {
      var hj = (crear || App.hoja)({ titulo: 'Departamentos', ancho: 520 });
      var lista = h('div.lista-ed');
      var nuevo = h('div.dep-nuevo');
      App.add(hj.cuerpo, h('p', { style: { color: 'var(--suave)', marginBottom: '12px' } }, 'Cada departamento es una sala del edificio. El edificio crece solo cuando sumás más. Los cambios se guardan solos.'), lista, nuevo);
      var botonNuevo = h('button.btn.izq', { onclick: function () { filaNueva(); } }, App.icono('mas'), 'Nuevo departamento');
      App.add(hj.pie, botonNuevo, hj.enVentana ? null : h('button.btn.primario', { onclick: hj.cerrar }, 'Listo'));

      /* «Nuevo departamento» como una fila al final de la lista, sin ventana */
      function filaNueva() {
        var o = App.E.oficina;
        var inp = h('input.campo', { maxlength: 60, placeholder: 'Nombre del departamento', 'aria-label': 'Nombre del departamento nuevo' });
        function crear() {
          var v = inp.value.trim(); if (!v) { inp.focus(); return; }
          ok.disabled = true;
          api.post('/api/departamentos', { nombre: v, color: App.PALETA[o.departamentos.length % App.PALETA.length] })
            .then(function (r) { App.actualizar(r.oficina); App.vaciar(nuevo); botonNuevo.disabled = false; pintar(); App.guardado('Departamento «' + v + '» creado.'); })
            .catch(function (e) { App.fallo(e); ok.disabled = false; });
        }
        function cancelar() { App.vaciar(nuevo); botonNuevo.disabled = false; }
        var ok = h('button.btn.primario', { onclick: crear }, 'Crear');
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); crear(); } if (e.key === 'Escape') { e.stopPropagation(); cancelar(); } });
        App.add(App.vaciar(nuevo), inp, ok, h('button.btn', { onclick: cancelar }, 'Cancelar'));
        botonNuevo.disabled = true; inp.focus();
      }

      function pintar() {
        var o = App.E.oficina;
        App.vaciar(lista);
        if (!o.departamentos.length) lista.appendChild(h('div.vacio', 'Todavía no hay departamentos. Creá el primero con «Nuevo departamento».'));
        o.departamentos.forEach(function (d) {
          var n = o.agentes.filter(function (a) { return a.departamento === d.id; }).length;
          var muestra = h('button.muestra', { style: { background: d.color }, title: 'Cambiar color', onclick: function () {
            App.elegirColor(muestra, d.color, function (c) { guardar(d.id, { color: c }, pintar, { color: d.color }); });
          } });
          var inp = h('input.dep-nombre', { value: d.nombre, maxlength: 60, 'aria-label': 'Nombre del departamento', title: 'Clic para cambiar el nombre' });
          var guardarNombre = function () { var v = inp.value.trim(); if (v && v !== d.nombre) guardar(d.id, { nombre: v }, pintar, { nombre: d.nombre }); else inp.value = d.nombre; };
          inp.addEventListener('blur', guardarNombre);
          inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); });
          /* misión: una línea que dice para qué existe el departamento; se guarda al salir del campo.
             Si el backend la ignora, el campo simplemente queda vacío al reabrir. */
          var ultima = d.mision || '';
          var mis = h('textarea.dep-mision', { rows: 1, maxlength: 600, placeholder: 'Agregá una misión: para qué existe este departamento', 'aria-label': 'Misión de ' + d.nombre });
          mis.value = ultima;
          /* crece con el texto: se lee como un párrafo, no como una caja */
          var ajustar = function () { mis.style.height = 'auto'; mis.style.height = mis.scrollHeight + 'px'; };
          mis.addEventListener('input', ajustar);
          requestAnimationFrame(ajustar);
          mis.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mis.blur(); } if (e.key === 'Escape') { mis.value = ultima; ajustar(); mis.blur(); } });
          inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { inp.value = d.nombre; inp.blur(); } });
          mis.addEventListener('blur', function () {
            var v = mis.value.trim();
            if (v === ultima) return;
            api.patch('/api/departamentos/' + encodeURIComponent(d.id), { mision: v }).then(function (r) {
              var antes = ultima;
              ultima = v; if (r && r.oficina) App.actualizar(r.oficina);
              App.guardado('Misión guardada.', function () { guardar(d.id, { mision: antes }, pintar); });
            }).catch(function (e) { App.fallo(e); });
          });
          var tarjeta = h('div.dep-tarjeta',
            muestra,
            h('div.dep-cuerpo', inp, mis),
            h('div.dep-acciones',
              h('span.insignia', n + (n === 1 ? ' agente' : ' agentes')),
              h('button.btn.fantasma.icono.dep-borrar', { title: 'Borrar departamento', onclick: function () { borrar(d, n, pintar); } }, App.icono('papelera'))));
          tarjeta.style.setProperty('--dep-color', d.color);
          lista.appendChild(tarjeta);
        });
      }
      pintar();
    },
    agregar: function (alListo) { agregar(alListo); },
    guardar: function (id, cambios, alListo) { guardar(id, cambios, alListo); },
    borrar: function (d, alListo) {
      var n = App.E.oficina.agentes.filter(function (a) { return a.departamento === d.id; }).length;
      borrar(d, n, alListo);
    },
    menu: menuDepto
  };
  /* `antes` (opcional): los valores de antes; con eso el aviso «Guardado» ofrece «Deshacer» */
  function guardar(id, cambios, alListo, antes) {
    api.patch('/api/departamentos/' + encodeURIComponent(id), cambios).then(function (r) {
      App.actualizar(r.oficina); if (alListo) alListo();
      App.guardado('Guardado.', antes ? function () { guardar(id, antes, alListo); } : null);
    }).catch(function (e) { App.fallo(e); if (alListo) alListo(); });
  }
  /* desde fuera de la lista (⌘K, menú «Nuevo»): se pregunta el nombre */
  function agregar(alListo) {
    var o = App.E.oficina;
    App.preguntar('Nuevo departamento', 'Nombre').then(function (nombre) {
      if (!nombre) return;
      api.post('/api/departamentos', { nombre: nombre, color: App.PALETA[o.departamentos.length % App.PALETA.length] })
        .then(function (r) { App.actualizar(r.oficina); if (alListo) alListo(); App.guardado('Departamento «' + nombre + '» creado.'); }).catch(App.fallo);
    });
  }
  function borrar(d, n, alListo) {
    var o = App.E.oficina;
    if (!n) {
      App.confirmar('¿Borrar ' + d.nombre + '?', 'La sala desaparece del edificio.', 'Borrar', true).then(function (si) {
        if (si) api.del('/api/departamentos/' + encodeURIComponent(d.id)).then(function (r) { App.actualizar(r.oficina); if (alListo) alListo(); }).catch(App.fallo);
      });
      return;
    }
    var otros = o.departamentos.filter(function (x) { return x.id !== d.id; });
    if (!otros.length) { App.aviso('Es el único departamento y tiene gente. Creá otro primero para moverlos.', true); return; }
    var hj2 = App.hoja({ titulo: '¿Borrar ' + d.nombre + '?', ancho: 460 });
    var destino = App.elegir({ etiqueta: 'Departamento al que pasan', valor: otros[0].id,
      opciones: otros.map(function (x) { return { valor: x.id, titulo: x.nombre, color: x.color }; }) });
    App.add(hj2.cuerpo, h('p', { style: { color: 'var(--suave)', marginBottom: '12px' } }, 'Tiene ' + n + (n === 1 ? ' agente' : ' agentes') + '. ¿A qué departamento los paso?'), destino);
    App.add(hj2.pie, h('button.btn', { onclick: hj2.cerrar }, 'Cancelar'), h('button.btn.primario.peligro', {
      onclick: function () {
        api.del('/api/departamentos/' + encodeURIComponent(d.id), { moverA: destino.valor() }).then(function (r) { hj2.cerrar(); App.actualizar(r.oficina); if (alListo) alListo(); }).catch(App.fallo);
      }
    }, 'Mover y borrar'));
  }

  /* menú del título de un departamento en la barra lateral */
  function menuDepto(ancla, d) {
    App.menu(ancla, [
      { texto: 'Contratar en ' + d.nombre + '…', icono: 'mas', accion: function () { App.Contratar.abrir({ departamento: d.id }); } },
      '-',
      { texto: 'Cambiar nombre…', icono: 'lapiz', accion: function () {
        App.preguntar('Cambiar nombre', 'Nombre del departamento', d.nombre).then(function (v) { if (v && v !== d.nombre) guardar(d.id, { nombre: v }, null, { nombre: d.nombre }); });
      } },
      { texto: 'Cambiar color…', icono: 'chispa', accion: function () { App.elegirColor(ancla, d.color, function (c) { guardar(d.id, { color: c }, null, { color: d.color }); }); } },
      { texto: 'Misión y más…', icono: 'capas', accion: function () { App.Nav.ir('#/equipo/departamentos'); } },
      '-',
      { texto: 'Borrar departamento…', icono: 'papelera', accion: function () { App.Departamentos.borrar(d); } }
    ]);
  }
})();
