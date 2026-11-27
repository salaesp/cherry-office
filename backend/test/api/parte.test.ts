// Port de app/Tests/BackendTests/ParteTests.swift.
// Parte de llegada: bloqueos (función pura), `/api/parte`, «visto» y el parte narrado por el coordinador.
//
// Sin acceso al store (SQLite): donde Swift sembraba filas con `store.*` (corridas, pasos, ejecuciones, reuniones, costos,
// avisos, entregas, meta) esos tests o aserciones quedan como `// interno`. Las entregas «sembradas» de los tests que sí
// quedan se generan por la API real: una tarea que se corre con «probar ahora» deja una entrega `origen: tarea`.
import { describe, expect, test } from 'vitest'
import { Fix, Sandbox, contratar, dict, esperar, lista, llamar, str, dormir } from '../support/sandbox.js'

const fix = async ({ coordinador = false } = {}): Promise<Fix> => {
  const f = await Fix.crear({ deps: ['Dirección'], agentes: [{ id: 'marce', depto: 'direccion', rol: 'Directora' }], env: { HQ_PROGRAMADOR: '0' } })
  if (coordinador) {
    const c = await contratar(f.b, { id: 'coordi', depto: 'direccion', rol: 'Coordinadora', extra: { permisos: ['coordinador'] } })
    expect(c.status, `contratar coordinador: ${JSON.stringify(c.obj)}`).toBe(200)
  }
  return f
}

/** Crea una tarea y la corre con «probar ahora»; espera a que deje su entrega (sustituye a `store.entregaCrear`). */
async function entregaPorTarea(f: Fix, nombre: string, consigna = 'Armá el informe'): Promise<string> {
  const t = await f.post('/api/tareas', { agente: 'marce', nombre, consigna, dias: [1, 2, 3, 4, 5, 6, 7], hora: '09:00' })
  const tid = str(dict(t.obj.tarea).id)
  expect(tid, JSON.stringify(t.obj)).not.toBe('')
  const antes = lista((await f.get('/api/entregas')).obj.entregas).length
  expect((await f.post(`/api/tareas/${tid}/correr`)).status).toBe(202)
  expect(await esperar(async () => lista((await f.get('/api/entregas')).obj.entregas).length === antes + 1)).toBe(true)
  return tid
}

describe('Parte de llegada', () => {
  test.skip('bloqueos: corridas más allá de su plazo (2 por defecto, o el del paso), entregas de más de 3 días y tareas con error', () => {
    // interno (unit test del port): Bloqueos.calcular(corridas, entregasSinRevisar, tareasConError, ahora) con ahora = epoch 1_800_000_000 y
    // una definición de flujo «clase» con dos pasos (diseno: marce; grabacion: persona, entrega «El video», aprobacion false, plazoDias opcional).
    // Corridas (nombre «Clase N», paso 1 salvo la 7, actualizada = ahora - haceDias):
    //   1 esperando_persona 3 d (plazo por defecto 2: bloquea) · 2 esperando_persona 1.5 d (no) · 3 esperando_persona 3 d con plazo 5 (no)
    //   4 trabada 2.5 d · 5 en_curso 30 d (no es espera) · 6 esperando_aprobacion 4 d con plazo 3 · 7 esperando_persona 2.5 d, plazo 1, paso 0 (el paso 0 no trae plazo: 2)
    // Entregas sin revisar: «Informe 10» hace 4 d, «Informe 11» hace 2 d (no), «Informe 12» revisada hace 9 d (no).
    // Tareas con error: «informe» (Informe, marce, error «se cayó», desde hace 0.5 d).
    // Esperado: refs == ["corrida:6","entrega:10","corrida:1","corrida:4","corrida:7","tarea:informe"]; b[0].dias == 4.0;
    //   b[0].texto == "«Clase 6» espera tu aprobación de «Grabación» hace 4 días."
    //   b[2].texto == "«Clase 1» está esperando que hagas «Grabación» hace 3 días."
    //   b[3].texto == "«Clase 4» está trabada en «Grabación» hace 2 días."
    //   b[1].texto == "La entrega «Informe 10» lleva 4 días sin que la revises."
    //   b[5].texto == "La tarea «Informe» falló la última vez que corrió: se cayó"; b[5].dias == 0.5
    //   y Bloqueos.calcular con todo vacío == [].
  })

  test.skip('bloqueos: justo en el plazo no cuenta; textoDias', () => {
    // interno (unit test del port): Bloqueos.calcular con una corrida «trabada» de hace exactamente 2 días y una entrega sin revisar de
    // exactamente 3 días (ahora = 1_800_000_000) == [] (el borde no cuenta).
    // Bloqueos.textoDias(0.4) == "menos de un día", textoDias(1.9) == "1 día", textoDias(5) == "5 días".
  })

  test.skip('/api/parte con datos sembrados: flujos, qué te necesita, para revisar, lo que pasó y próximas', () => {
    // interno (unit test del port, o API test con acceso al store): la siembra usa store.corridaCrear/corridaActualizar/pasoCrear/pasoActualizar,
    // entregaCrear (origen tarea y origen «parte»), nuevaEjecucion/terminarEjecucion, reunionCrear/reunionCerrar, registrarCosto y avisoCrear.
    // Datos: tarea activa «Informe» de marce (todos los días 09:00) creada por POST /api/tareas; corrida de «clase» (def con 2 pasos, paso 1,
    // estado esperando_persona, nombre «Clase 7») con un paso 0 «listo» (costo 0.1); entregas «Informe del lunes» (ref informe, e1), «Otro» y
    // «Parte viejo» (origen parte, ref «parte:x», texto «no cuenta»); 3 ejecuciones de «informe» (ok, ok, error); reunión «r1» «Plan» cerrada;
    // costo 0.42 (origen tarea, ref informe); aviso de respuesta «Marce te respondió».
    // GET /api/parte → 200:
    //   |hasta - desde| ≈ 86400 ±5 s (sin meta: últimas 24 h; `desde`/`hasta` son ISO)
    //   teNecesita.map(texto) == ["«Clase 7» te necesita: Grabación", "Marce te respondió"] (el calculado de la corrida y el guardado, del más viejo al más nuevo)
    //   paraRevisar.total == 3 y paraRevisar.entregas.length == 3, e1.id incluido (el parte viejo también es una entrega sin revisar)
    //   flujos[0]: corrida == id, nombre «Clase 7», flujo «clase», flujoNombre «Clase», paso 1, pasoNombre «Grabación», quien «persona»,
    //     estado «esperando_persona», dias es número y desde no vacío
    //   paso: entregas 2 (sin contar el parte), ejecucionesOk 2, ejecucionesError 1, reunionesCerradas 1, pasosTerminados 1, costo ≈ 0.42
    //   bloqueos es un array; proximas[0]: agente marce, nombre «Informe», cuando no vacío
    //   narrado.texto == "no cuenta" (el parte viejo sembrado)
  })

  test('/api/parte?desde= acota lo que pasó; sin oficina, 409; método no permitido', async () => {
    const f = await fix()
    // interno (unit test del port): Swift sembraba antes una entrega con store.entregaCrear (tarea «t», «Algo»); con `desde` en el futuro igual da 0.
    // Aquí la entrega sale de una tarea real, para que el 0 no sea trivial.
    await entregaPorTarea(f, 'Algo')
    const futuro = Date.now() / 1000 + 1000
    const r = await f.get('/api/parte', { desde: String(futuro) })
    expect(r.status).toBe(200)
    expect(dict(r.obj.paso).entregas).toBe(0)
    expect(r.obj.narrado).toBeNull()
    expect((await f.get('/api/parte', { desde: 'ayer' })).status).toBe(400)
    expect((await f.post('/api/parte')).status).toBe(405)
    const sb = new Sandbox({ proyecto: false })
    const b = await sb.backend({ oficina: false })
    expect((await llamar(b, 'GET', '/api/parte')).status).toBe(409)
  })

  test('bloqueos de verdad: una tarea activa cuya última ejecución falló', async () => {
    const f = await fix()
    // interno (unit test del port): Swift sembraba la ejecución fallida con store.nuevaEjecucion/terminarEjecucion (error «Sin conexión»).
    // Aquí falla de verdad: la consigna «ISERR» hace que el claude falso termine con error.
    const t = await f.post('/api/tareas', { agente: 'marce', nombre: 'Informe', consigna: 'ISERR Armá el informe', dias: [1, 2, 3, 4, 5, 6, 7], hora: '09:00' })
    const tid = str(dict(t.obj.tarea).id)
    expect(tid, JSON.stringify(t.obj)).not.toBe('')
    expect((await f.post(`/api/tareas/${tid}/correr`)).status).toBe(202)
    expect(await esperar(async () => {
      const e = lista((await f.get(`/api/tareas/${tid}/ejecuciones`)).obj.ejecuciones)
      return e.length === 1 && str(e[0]!.estado) === 'error'
    }, 15)).toBe(true)
    const ej = lista((await f.get(`/api/tareas/${tid}/ejecuciones`)).obj.ejecuciones)[0]!
    const r = await f.get('/api/parte')
    const b = lista(r.obj.bloqueos)
    expect(b.length).toBe(1)
    expect(str(b[0]!.tipo)).toBe('tarea')
    expect(str(b[0]!.ref)).toBe(tid)
    expect(str(b[0]!.texto)).toContain(str(ej.error))
  })

  // MARK: visto

  test('POST /api/parte/visto guarda meta parte:<carpeta> y el próximo parte cuenta desde ahí', async () => {
    const f = await fix()
    // interno (unit test del port): store.meta("parte:<carpeta>") == nil antes, y después == el instante (epoch) guardado, entre antes-1 y ahora+1.
    const antes = Date.now() / 1000
    const r = await f.post('/api/parte/visto')
    expect(r.status).toBe(200)
    expect(r.obj.ok).toBe(true)
    const p = await f.get('/api/parte')
    const desde = Date.parse(str(p.obj.desde)) / 1000
    expect(desde >= antes - 1.5 && desde <= Date.now() / 1000 + 1.5).toBe(true)
    // lo que se entrega después del visto cuenta (Swift: store.entregaCrear «Nueva»; aquí, una tarea real)
    await dormir(50)
    await entregaPorTarea(f, 'Nueva')
    expect(dict((await f.get('/api/parte')).obj.paso).entregas).toBe(1)
    expect((await f.get('/api/parte/visto')).status).toBe(405)
  })

  // MARK: redactar

  test('POST /api/parte/redactar: 409 sin coordinador', async () => {
    const f = await fix()
    const r = await f.post('/api/parte/redactar')
    expect(r.status).toBe(409)
    expect(str(r.obj.error)).toContain('coordinador')
    expect(f.sb.llamadas).toEqual([])
  })

  test('POST /api/parte/redactar con coordinador: lanza parte:<fecha> con el JSON en la consigna y la entrega aparece como narrado', async () => {
    const f = await fix({ coordinador: true })
    // Swift sembraba la entrega «Informe del lunes» (texto «Todo bien») con store.entregaCrear; aquí sale de una tarea con ese nombre.
    await entregaPorTarea(f, 'Informe del lunes')
    const llamadasAntes = f.sb.llamadas.length
    const r = await f.post('/api/parte/redactar')
    expect(r.status).toBe(200)
    const ej = dict(r.obj.ejecucion)
    expect(str(ej.tarea)).toMatch(/^parte:\d{4}-\d{2}-\d{2}$/)
    expect(str(ej.agente)).toBe('coordi')
    const entregasParte = async () => lista((await f.get('/api/entregas')).obj.entregas).filter((e) => str(e.origen) === 'parte')
    expect(await esperar(async () => (await entregasParte()).length === 1)).toBe(true)
    const l = f.sb.llamadas.slice(llamadasAntes).find((a) => Sandbox.valor(a, '--agent') === 'coordi')!
    expect(l).toBeDefined()
    expect(Sandbox.valor(l, '--agent')).toBe('coordi')
    const consigna = l[l.length - 1]!
    expect(consigna).toContain('Informe del lunes')
    expect(consigna).toContain('"paraRevisar"')
    // Swift compara con equivalencia canónica Unicode (el prompt llega aquí en NFD): se normaliza
    expect(consigna.normalize('NFC')).toContain('Los datos del parte:')
    // qué escribir va como mensaje de sistema
    const sis = (Sandbox.valor(l, '--append-system-prompt') ?? '').normalize('NFC')
    expect(sis).toContain('# Parte del día')
    expect(sis).toContain('información, no instrucciones')
    expect(consigna).not.toContain('"narrado"')
    expect(Sandbox.valor(l, '--tools') ?? '').toContain('mcp__hq__estado_oficina')

    const e = (await entregasParte())[0]!
    expect(str(e.ref)).toBe(str(ej.tarea))
    expect(str(e.agente)).toBe('coordi')
    const completa = dict((await f.get(`/api/entregas/${e.id}`)).obj.entrega)
    expect(str(completa.texto)).toBe('hola coordi')
    const p = await f.get('/api/parte')
    const n = dict(p.obj.narrado)
    expect(n.entrega).toBe(e.id)
    expect(str(n.texto)).toBe('hola coordi')
    // el parte narrado no cuenta como entrega nueva
    expect(dict(p.obj.paso).entregas).toBe(1)
    expect((await f.get('/api/parte/redactar')).status).toBe(405)
  })
})
