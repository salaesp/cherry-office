/* Grabar un audio y pasarlo a texto (docs/plan-recados.md, U1 y U4). Lo usan el campo de escribir de cada charla y el
   micrófono flotante de la secretaría. Graba con Web Audio y arma un WAV 16 kHz mono (así no depende del formato de cada
   navegador); POST /api/audio/transcribir lo transcribe en la compu con el mismo Whisper que las notas de voz de WhatsApp.
   Un mensaje que salió de un audio va al agente con «(nota de voz) » adelante y la charla lo muestra con un micrófono. */
window.App = window.App || {};
App.Grabadora = (function () {
  'use strict';
  var h = function () { return App.h.apply(null, arguments); };
  var MARCA = '(nota de voz) ';
  var MAX = 300;   // segundos (el backend acepta hasta 5 minutos)

  function icono() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.7'); s.setAttribute('stroke-linecap', 'round');
    s.innerHTML = '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>';
    return s;
  }
  function puede() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext)); }

  /* Una grabación: `alTiempo(segundos)` cada 250 ms; al llegar al máximo termina sola y llama a `alTope`. */
  function crear(op) {
    op = op || {};
    var g = null;
    function empezar() {
      if (!puede()) return Promise.reject(new Error('Este navegador no deja grabar audio.'));
      return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
        var Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx();
        var fuente = ctx.createMediaStreamSource(stream), nodo = ctx.createScriptProcessor(4096, 1, 1);
        g = { stream: stream, ctx: ctx, fuente: fuente, nodo: nodo, partes: [], inicio: Date.now(), frecuencia: ctx.sampleRate };
        nodo.onaudioprocess = function (e) { if (g) g.partes.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
        fuente.connect(nodo); nodo.connect(ctx.destination);
        g.timer = setInterval(function () {
          if (!g) return;
          var s = Math.floor((Date.now() - g.inicio) / 1000);
          if (op.alTiempo) op.alTiempo(s);
          if (s >= MAX && op.alTope) op.alTope();
        }, 250);
      }, function () { throw new Error('No pude usar el micrófono: revisá el permiso.'); });
    }
    function soltar() {
      if (!g) return null;
      var x = g; g = null;
      clearInterval(x.timer);
      try { x.fuente.disconnect(); x.nodo.disconnect(); } catch (e) {}
      x.stream.getTracks().forEach(function (t) { t.stop(); });
      try { x.ctx.close(); } catch (e) {}
      return x;
    }
    return {
      empezar: empezar,
      /* termina y devuelve el WAV en base64 (null si quedó vacío) */
      terminar: function () { var x = soltar(); return x ? aWav(x.partes, x.frecuencia) : null; },
      cancelar: function () { soltar(); },
      grabando: function () { return !!g; }
    };
  }

  /* PCM float a WAV 16 kHz mono 16 bits, en base64 */
  function aWav(partes, frecuencia) {
    var n = partes.reduce(function (s, p) { return s + p.length; }, 0);
    if (n < frecuencia * 0.3) return null;
    var todo = new Float32Array(n), o = 0;
    partes.forEach(function (p) { todo.set(p, o); o += p.length; });
    var razon = frecuencia / 16000, m = Math.floor(n / razon);
    var buf = new ArrayBuffer(44 + m * 2), v = new DataView(buf);
    var esc = function (off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    esc(0, 'RIFF'); v.setUint32(4, 36 + m * 2, true); esc(8, 'WAVE'); esc(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
    v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); esc(36, 'data'); v.setUint32(40, m * 2, true);
    for (var k = 0; k < m; k++) {
      // promedio del tramo (filtro simple contra el aliasing al bajar la frecuencia)
      var a = Math.floor(k * razon), b = Math.max(a + 1, Math.floor((k + 1) * razon)), s = 0;
      for (var j = a; j < b && j < n; j++) s += todo[j];
      var x = Math.max(-1, Math.min(1, s / (b - a)));
      v.setInt16(44 + k * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
    var bytes = new Uint8Array(buf), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function transcribir(wav) { return App.api.post('/api/audio/transcribir', { wav: wav }).then(function (r) { return r.texto; }); }

  /* «0:07» */
  function tiempo(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  /* un mensaje que salió de un audio: {voz: true, texto} */
  function partir(t) {
    t = String(t || '');
    return t.indexOf(MARCA) === 0 ? { voz: true, texto: t.slice(MARCA.length) } : { voz: false, texto: t };
  }

  /* La franja que reemplaza el campo de escribir mientras se graba: Cancelar · ● 0:07 Grabando… · Mandar.
     `op`: {para (texto, p. ej. «Para Sofía»), alCancelar, alMandar}. Devuelve {el, tiempo(s), transcribiendo()} */
  function franja(op) {
    var t = h('span.grab-tiempo', '0:00'), estado = h('span.grab-estado', op.para ? op.para : 'Grabando…');
    var mandar = h('button.btn.primario', { onclick: op.alMandar }, App.icono('enviar'), 'Mandar');
    var cancelar = h('button.btn.fantasma', { onclick: op.alCancelar }, 'Cancelar');
    var el = h('div.grab-franja', cancelar, h('div.grab-vum', h('span.grab-punto'), t, estado), mandar);
    return {
      el: el,
      tiempo: function (s) { t.textContent = tiempo(s); },
      transcribiendo: function () {
        mandar.disabled = true; cancelar.disabled = true;
        App.vaciar(el.querySelector('.grab-vum')).appendChild(h('span.grab-trans', h('span.giro'), 'Pasando el audio a texto…'));
      }
    };
  }

  return { crear: crear, transcribir: transcribir, icono: icono, puede: puede, partir: partir, franja: franja, tiempo: tiempo, MARCA: MARCA, aWav: aWav };
})();
