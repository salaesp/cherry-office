/* Skills propias de cada agente (backend/src/skills-propias.ts): instrucciones que el agente lee cuando le piden algo
   parecido, guardadas en la carpeta de la oficina. Acá: la sección de la ficha (Permisos), el editor, las propuestas que
   hace el agente (proponer_skill, llegan como aviso «te necesita») y «Convertir en skill» desde una charla. */
App.SkillsPropias = (function () {
  'use strict';
  var h = App.h, api = App.api;
  var leyendo = {};   // sesión -> true mientras se lee esa charla

  /* las secciones abiertas en la ficha vuelven a pedir la lista cuando algo cambia desde otro lado (aviso, charla) */
  var oyentes = [];
  function refrescarFicha(id) { oyentes.slice().forEach(function (f) { f(id); }); }

  function url(id, resto) { return '/api/agentes/' + encodeURIComponent(id) + '/' + (resto || 'skills'); }
  function slug(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  }

  /* Sección «Skills propias» de la ficha. Se pinta sola y se repinta después de cada cambio. */
  function seccion(a) {
    var zona = h('div');
    function pintar(r) {
      App.vaciar(zona);
      var skills = r.skills || [], propuestas = r.propuestas || [];
      var filas = [];
      propuestas.forEach(function (p) {
        filas.push(App.filaDecision({
          marca: 'chispa', clase: 'skill-propuesta',
          titulo: (p.cambio ? 'Propone mejorar «' : 'Propone «') + p.nombre + '»',
          sub: p.motivo || p.descripcion,
          principal: h('button.btn.chico.primario', { onclick: function () { editor(a, p, { propuesta: p, alGuardar: pintar }); } }, 'Revisar'),
          mas: [{ texto: 'Descartar', icono: 'cerrar', peligro: true, accion: function () { descartar(a, p).then(function (r2) { if (r2) pintar(r2); }); } }],
          alTocar: function () { editor(a, p, { propuesta: p, alGuardar: pintar }); },
        }));
      });
      skills.forEach(function (s) {
        filas.push(App.filaDecision({
          marca: 'libro', titulo: s.nombre, sub: s.descripcion,
          principal: h('button.btn.chico', { onclick: function () { editor(a, s, { existente: true, alGuardar: pintar }); } }, 'Editar'),
          mas: [{ texto: 'Borrar', icono: 'papelera', peligro: true, accion: function () { borrar(a, s).then(function (r2) { if (r2) pintar(r2); }); } }],
          alTocar: function () { editor(a, s, { existente: true, alGuardar: pintar }); },
        }));
      });
      App.add(zona, App.seccion('Skills propias', [
        filas.length ? filas : h('div.ayuda', a.nombre + ' todavía no tiene skills propias.'),
        h('button.btn.chico.fantasma', { onclick: function () { editor(a, null, { alGuardar: pintar }); } }, App.icono('mas'), 'Nueva skill')],
        { cuenta: skills.length ? String(skills.length) : null,
          ayuda: 'Lo que ' + a.nombre + ' lee cuando le piden algo parecido. También salen de una charla con «Convertir en skill».' }));
    }
    function oyente(id) {
      if (!zona.isConnected) { oyentes.splice(oyentes.indexOf(oyente), 1); return; }
      if (id === a.id) api.get(url(a.id)).then(pintar).catch(function () {});
    }
    oyentes.push(oyente);
    zona.appendChild(App.seccion('Skills propias', App.cargando('Trayendo sus skills…')));
    api.get(url(a.id)).then(pintar).catch(function (e) { App.vaciar(zona).appendChild(App.seccion('Skills propias', h('div.error-txt', e.message))); });
    return zona;
  }

  function borrar(a, s) {
    return App.confirmar('Borrar «' + s.nombre + '»', a.nombre + ' deja de tener esta skill. No se puede deshacer.', 'Borrar', true).then(function (ok) {
      if (!ok) return null;
      return api.del(url(a.id, 'skills/' + encodeURIComponent(s.nombre))).then(function (r) { App.aviso('Skill borrada.'); return r; }).catch(function (e) { App.fallo(e); return null; });
    });
  }
  function descartar(a, p) {
    return api.del(url(a.id, 'propuestas-skill/' + encodeURIComponent(p.id))).then(function (r) { App.aviso('Propuesta descartada.'); return r; }).catch(function (e) { App.fallo(e); return null; });
  }

  /* Editor de una skill. `s`: {nombre, descripcion, contenido} o null (nueva).
     op: {existente?: true (se edita, el nombre queda), propuesta?: la propuesta que se revisa, deCharla?: true, alGuardar?(listado)} */
  function editor(a, s, op) {
    op = op || {};
    s = s || { nombre: '', descripcion: '', contenido: '' };
    var titulo = op.existente ? 'Skill «' + s.nombre + '»' : op.propuesta ? 'Propuesta de ' + a.nombre : 'Nueva skill de ' + a.nombre;
    var hj = App.hoja({ titulo: titulo, ancho: 680, clave: 'skill-propia' });
    var nombre = h('input.campo', { value: s.nombre, maxlength: 64, placeholder: 'por-ejemplo-resumen-de-mails', spellcheck: 'false', disabled: !!op.existente, autofocus: !op.existente });
    nombre.addEventListener('blur', function () { if (!op.existente) nombre.value = slug(nombre.value); });
    var desc = h('textarea.campo', { rows: 2, maxlength: 1024, placeholder: 'Usala cuando te pidan…' });
    desc.value = s.descripcion || '';
    var cont = h('textarea.campo.skill-contenido', { rows: 16, maxlength: 40000, spellcheck: 'true', placeholder: '# Cómo hacerlo\n\n1. …\n2. …' });
    cont.value = s.contenido || '';
    var err = h('div.error-txt');
    function campo(etq, ayuda, control) { return h('div.fila-campo', h('label.etiqueta-campo', etq), ayuda ? h('div.ayuda', ayuda) : null, control); }
    var p = op.propuesta;
    App.add(hj.cuerpo,
      p ? h('div.skill-aviso', h('b', a.nombre + (p.cambio ? ' propone mejorar una skill que ya tiene.' : ' propone guardar esta skill.')), p.motivo ? h('div', p.motivo) : null,
        h('div.ayuda', 'Revisala y corregila si hace falta: recién al guardarla la va a tener.')) : null,
      op.deCharla ? h('div.skill-aviso', 'Borrador armado con la charla. Revisalo: recién al guardarlo ' + a.nombre + ' lo va a tener.') : null,
      campo('Nombre', op.existente ? null : 'En minúsculas, con guiones. No se puede cambiar después.', nombre),
      campo('Cuándo usarla', a.nombre + ' ve esta frase en una lista y por ella decide si la abre: decí qué hace y cuándo.', desc),
      campo('Instrucciones', 'Lo que tiene que saber o hacer, en markdown. Escribilas para alguien que no vio la charla.', cont),
      err);
    var guardar = h('button.btn.primario', { onclick: enviar }, op.existente ? 'Guardar' : p ? (p.cambio ? 'Aceptar el cambio' : 'Aceptar y guardar') : 'Guardar skill');
    App.add(hj.pie,
      p ? h('button.btn.fantasma', { style: { marginRight: 'auto' }, onclick: function () { descartar(a, p).then(function (r) { if (r) { hj.cerrar(); if (op.alGuardar) op.alGuardar(r); } }); } }, 'Descartar') : null,
      h('button.btn', { onclick: hj.cerrar }, 'Cancelar'), guardar);

    function enviar() {
      err.textContent = '';
      var cuerpo = { nombre: slug(nombre.value), descripcion: desc.value, contenido: cont.value };
      if (!op.existente && !cuerpo.nombre) { err.textContent = 'Poné un nombre.'; return; }
      guardar.disabled = true;
      var pedido;
      if (op.existente) pedido = api.put(url(a.id, 'skills/' + encodeURIComponent(s.nombre)), cuerpo);
      else { if (p) cuerpo.propuesta = p.id; pedido = api.post(url(a.id), cuerpo); }
      pedido.then(function (r) {
        hj.cerrar();
        App.aviso(op.existente ? 'Skill guardada.' : a.nombre + ' ya tiene la skill «' + cuerpo.nombre + '». La usa desde el próximo mensaje.');
        if (op.alGuardar) op.alGuardar(r);
        refrescarFicha(a.id);
      }).catch(function (e) { err.textContent = e.message; guardar.disabled = false; });
    }
    return hj;
  }

  /* Desde un aviso: abre la propuesta para revisarla */
  function revisar(agenteId, pid) {
    var a = App.agente(agenteId);
    if (!a) return;
    api.get(url(a.id)).then(function (r) {
      var p = (r.propuestas || []).filter(function (x) { return x.id === pid; })[0];
      if (!p) { App.aviso('Esa propuesta ya no está.'); return; }
      editor(a, p, { propuesta: p, alGuardar: function () { refrescarFicha(a.id); } });
    }).catch(App.fallo);
  }

  /* «Convertir en skill»: lee la charla (POST /api/chat/skill) y abre el editor con el borrador */
  function desdeCharla(a, sid) {
    if (!sid) { App.aviso('Charlá primero con ' + a.nombre + ': después se puede guardar lo que sirve como skill.'); return; }
    if (leyendo[sid]) return;
    var cerrada = false;
    var hj = App.hoja({ titulo: 'Convertir en skill', ancho: 460, alCerrar: function () { cerrada = true; } });
    leyendo[sid] = true;
    hj.cuerpo.appendChild(App.cargando('Leyendo la charla con ' + a.nombre + '…'));
    App.add(hj.pie, h('button.btn', { onclick: hj.cerrar }, 'Cancelar'));
    api.post('/api/chat/skill', { agent: a.id, session: sid }).then(function (r) {
      if (cerrada) return;
      if (!r.borrador) {
        App.vaciar(hj.cuerpo).appendChild(App.vacio('chispa', 'No encontré nada para guardar', r.motivo || 'En esta charla no hay un procedimiento que valga la pena repetir.'));
        App.vaciar(hj.pie).appendChild(h('button.btn.primario', { onclick: hj.cerrar }, 'Listo'));
        return;
      }
      hj.cerrar();
      var b = r.borrador;
      /* mejora una que ya tiene: se edita esa (el nombre queda) */
      editor(a, b, b.existente ? { existente: true, deCharla: true } : { deCharla: true });
    }).catch(function (e) {
      if (!cerrada) App.vaciar(hj.cuerpo).appendChild(h('div.error-txt', e.message));
    }).then(function () { delete leyendo[sid]; });
  }

  return { seccion: seccion, editor: editor, revisar: revisar, desdeCharla: desdeCharla };
})();
