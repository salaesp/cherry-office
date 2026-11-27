// Parte de llegada sin servidor HTTP: Bloqueos.calcular (función pura) y /api/parte con datos sembrados en la base.
// Reescribe los tests `interno` de ParteTests.swift.
import { describe, expect, test } from 'vitest'
import type { Corrida } from '../../src/corridas-store.js'
import type { Entrega } from '../../src/entregas.js'
import { Bloqueos, Parte, corridasDe, type TareaConError } from '../../src/parte.js'
import { programadorDe } from '../../src/programador.js'
import { Programacion } from '../../src/tareas.js'
import { Sandbox } from '../support/sandbox.js'
import { arrancar, llamar, oficina } from '../support/en-proceso.js'

const dia = 86400
const ahora = new Date(1_800_000_000 * 1000)

const def = (plazo?: number) => JSON.stringify({
  id: 'clase', nombre: 'Clase', pasos: [
    { id: 'diseno', nombre: 'Diseño', quien: 'marce', entrega: 'x' },
    { id: 'grabacion', nombre: 'Grabación', quien: 'persona', entrega: 'El video', aprobacion: false, ...(plazo === undefined ? {} : { plazoDias: plazo }) },
  ],
})

const corrida = (id: number, estado: string, haceDias: number, plazo?: number, paso = 1): Corrida => ({
  id, oficina: '/o', flujo: 'clase', nombre: `Clase ${id}`, contexto: '', definicion: def(plazo), paso, estado, creada: 0,
  actualizada: ahora.getTime() / 1000 - haceDias * dia, vista: false,
})

const entrega = (id: number, haceDias: number, estado = 'sin_revisar'): Entrega => ({
  id, oficina: '/o', agente: 'marce', origen: 'tarea', ref: 't', titulo: `Informe ${id}`, texto: 'texto', sid: '', archivos: [],
  creada: ahora.getTime() / 1000 - haceDias * dia, estado,
})

describe('Bloqueos.calcular', () => {
  test('corridas más allá de su plazo (2 por defecto, o el del paso), entregas de más de 3 días y tareas con error', () => {
    const corridas = [
      corrida(1, 'esperando_persona', 3), // pasa el plazo por defecto
      corrida(2, 'esperando_persona', 1.5), // todavía no
      corrida(3, 'esperando_persona', 3, 5), // el paso admite 5
      corrida(4, 'trabada', 2.5),
      corrida(5, 'en_curso', 30), // en curso no es espera
      corrida(6, 'esperando_aprobacion', 4, 3),
      corrida(7, 'esperando_persona', 2.5, 1, 0), // el paso 0 no trae plazo: 2
    ]
    const entregas = [entrega(10, 4), entrega(11, 2), entrega(12, 9, 'revisada')]
    const tareas: TareaConError[] = [{ id: 'informe', nombre: 'Informe', agente: 'marce', error: 'se cayó', desde: ahora.getTime() / 1000 - 0.5 * dia }]
    const b = Bloqueos.calcular(corridas, entregas, tareas, ahora)
    expect(b.map((x) => `${x.tipo}:${x.ref}`)).toEqual(['corrida:6', 'entrega:10', 'corrida:1', 'corrida:4', 'corrida:7', 'tarea:informe'])
    expect(b[0]!.dias).toBe(4.0)
    expect(b[0]!.texto).toBe('«Clase 6» espera tu aprobación de «Grabación» hace 4 días.')
    expect(b[2]!.texto).toBe('«Clase 1» está esperando que hagas «Grabación» hace 3 días.')
    expect(b[3]!.texto).toBe('«Clase 4» está trabada en «Grabación» hace 2 días.')
    expect(b[1]!.texto).toBe('La entrega «Informe 10» lleva 4 días sin que la revises.')
    expect(b[5]!.texto).toBe('La tarea «Informe» falló la última vez que corrió: se cayó')
    expect(b[5]!.dias).toBe(0.5)
    expect(Bloqueos.calcular([], [], [], ahora)).toEqual([])
  })

  test('esperas entre agentes vencidas: «<agente>» espera a <B> («<que>») hace n días; las que no pasaron el plazo no cuentan', () => {
    const e = (id: number, haceDias: number, plazo = 2) => ({ id, agente: 'marce', agenteNombre: 'Marce', esperaANombre: 'Arqui', que: 'el mapeo', creada: ahora.getTime() / 1000 - haceDias * dia, plazo })
    const b = Bloqueos.calcular([corrida(1, 'esperando_persona', 3)], [], [], ahora, [e(7, 4), e(8, 1), e(9, 6, 7)])
    expect(b.map((x) => `${x.tipo}:${x.ref}`)).toEqual(['espera:7', 'corrida:1'])
    expect(b[0]).toEqual({ tipo: 'espera', texto: '«Marce» espera a Arqui («el mapeo») hace 4 días.', ref: '7', dias: 4.0 })
    // el parámetro es opcional
    expect(Bloqueos.calcular([], [], [], ahora)).toEqual([])
  })

  test('justo en el plazo no cuenta; textoDias', () => {
    expect(Bloqueos.calcular([corrida(1, 'trabada', 2)], [entrega(1, 3)], [], ahora)).toEqual([])
    expect(Bloqueos.textoDias(0.4)).toBe('menos de un día')
    expect(Bloqueos.textoDias(1.9)).toBe('1 día')
    expect(Bloqueos.textoDias(5)).toBe('5 días')
  })

  test('una corrida trabada en un paso de un agente nombra al agente; una definición ilegible no rompe', () => {
    const c = corrida(1, 'trabada', 5, undefined, 0)
    const b = Bloqueos.calcular([c, { ...corrida(2, 'trabada', 5), definicion: 'no es json' }], [], [], ahora)
    expect(b[0]!.texto).toBe('«Clase 1» está trabada en «Diseño» (marce) hace 5 días.')
    expect(b[1]!.texto).toBe('«Clase 2» está trabada en «el paso 2» hace 5 días.')
  })

  test('la tarea sin motivo no deja dos puntos; el motivo se corta en 160', () => {
    const t = (error: string): TareaConError => ({ id: 'i', nombre: 'I', agente: 'm', error, desde: ahora.getTime() / 1000 })
    expect(Bloqueos.calcular([], [], [t('  ')], ahora)[0]!.texto).toBe('La tarea «I» falló la última vez que corrió.')
    expect(Bloqueos.calcular([], [], [t('x'.repeat(200))], ahora)[0]!.texto).toBe('La tarea «I» falló la última vez que corrió: ' + 'x'.repeat(160))
  })
})

describe('Parte.armar / GET /api/parte con datos sembrados', () => {
  test('flujos, qué te necesita, para revisar, lo que pasó y próximas', async () => {
    const sb = new Sandbox()
    const b = arrancar(sb)
    const c = await oficina(b, ['marce'])
    const s = b.servicios
    const st = corridasDe(s)
    // una oficina con una tarea activa para «próximas»
    const t = await llamar(b, 'POST', '/api/tareas', { agente: 'marce', nombre: 'Informe', consigna: 'Armá el informe', dias: [1, 2, 3, 4, 5, 6, 7], hora: '09:00' })
    expect(t.status, JSON.stringify(t.obj)).toBe(200)
    // flujo esperando a la persona
    const cr = st.corridaCrear({ oficina: c, flujo: 'clase', nombre: 'Clase 7', contexto: '', definicion: def(), estado: 'esperando_persona' })!
    st.corridaActualizar(c, cr.id, { paso: 1 })
    const p1 = st.pasoCrear({ corrida: cr.id, paso: 0, intento: 1, quien: 'marce', estado: 'corriendo' })!
    st.pasoActualizar(p1.id, { estado: 'listo', fin: Date.now() / 1000, sumarCosto: 0.1 })
    // la corrida espera desde hace un minuto: si no, puede caer en el mismo milisegundo que el aviso guardado y el orden se vuelve azar
    s.store.db.run('UPDATE corridas SET actualizada=actualizada-60 WHERE id=?', [cr.id])
    // entregas, ejecuciones, reunión cerrada y un aviso
    const e1 = s.entregas.crear({ oficina: c, agente: 'marce', origen: 'tarea', ref: 'informe', titulo: 'Informe del lunes', texto: 'Todo bien' })!
    s.entregas.crear({ oficina: c, agente: 'marce', origen: 'tarea', ref: 'informe', titulo: 'Otro', texto: 'x' })
    s.entregas.crear({ oficina: c, agente: 'marce', origen: 'parte', ref: 'parte:x', titulo: 'Parte viejo', texto: 'no cuenta' })
    const ahoraS = Date.now() / 1000
    const ej = programadorDe(s)!.ejecuciones
    for (const estado of ['ok', 'ok', 'error']) {
      const id = ej.nueva({ oficina: c, tarea: 'informe', agente: 'marce', programada: ahoraS, inicio: ahoraS, sid: '', manual: true })
      ej.terminar(id, estado, 'r', estado === 'error' ? 'x' : undefined, undefined)
    }
    // una ejecución de un parte narrado no cuenta
    ej.terminar(ej.nueva({ oficina: c, tarea: 'parte:2026-01-01', agente: 'marce', programada: ahoraS, inicio: ahoraS, sid: '', manual: false }), 'ok', 'r', undefined, undefined)
    s.store.db.run("INSERT INTO reuniones(id,oficina,tema,agentes,estado,creada,cerrada) VALUES('r1',?,'Plan','[\"marce\"]','cerrada',?,?)", [c, ahoraS, ahoraS])
    s.store.registrarCosto({ oficina: c, agente: 'marce', origen: 'tarea', ref: 'informe', costo: 0.42 })
    s.avisos.crear({ oficina: c, tipo: 'respuesta', agente: 'marce', texto: 'Marce te respondió' })

    const r = await llamar(b, 'GET', '/api/parte')
    expect(r.status).toBe(200)
    const o = r.obj
    expect(Math.abs((Date.parse(o.hasta) - Date.parse(o.desde)) / 1000 - 86400)).toBeLessThan(5) // sin meta: las últimas 24 h
    // el aviso calculado de la corrida que espera a la persona y el guardado, del más viejo al más nuevo
    expect(o.teNecesita.map((x: any) => x.texto)).toEqual(['«Clase 7» te necesita: Grabación', 'Marce te respondió'])
    // para revisar (el parte viejo también es una entrega sin revisar de la bandeja)
    expect(o.paraRevisar.total).toBe(3)
    expect(o.paraRevisar.entregas.length).toBe(3)
    expect(o.paraRevisar.entregas.some((x: any) => x.id === e1.id)).toBe(true)
    // flujos
    const fl = o.flujos[0]
    expect(fl).toMatchObject({ corrida: cr.id, nombre: 'Clase 7', flujo: 'clase', flujoNombre: 'Clase', paso: 1, pasoNombre: 'Grabación', quien: 'persona', estado: 'esperando_persona' })
    expect(typeof fl.dias === 'number' && fl.desde !== '').toBe(true)
    // qué pasó
    expect(o.paso).toMatchObject({ entregas: 2, ejecucionesOk: 2, ejecucionesError: 1, reunionesCerradas: 1, pasosTerminados: 1 })
    // lo que falló, con su motivo, de quién y el nombre de la tarea en palabras
    expect(o.paso.errores).toEqual([expect.objectContaining({ tarea: 'informe', nombre: 'Informe', agente: 'marce', error: 'x' })])
    expect(Math.abs(o.paso.costo - 0.42)).toBeLessThan(1e-9)
    expect(Array.isArray(o.bloqueos)).toBe(true)
    // próximas
    expect(o.proximas[0]).toMatchObject({ agente: 'marce', nombre: 'Informe' })
    expect(o.proximas[0].cuando).not.toBe('')
    // el parte narrado es el viejo sembrado
    expect(o.narrado.texto).toBe('no cuenta')
  })

  test('«visto» guarda meta parte:<carpeta>; desde manda sobre la meta; una meta inválida o futura se ignora', async () => {
    const sb = new Sandbox()
    const b = arrancar(sb)
    const c = await oficina(b, ['marce'])
    const s = b.servicios
    expect(s.store.meta(`parte:${c}`)).toBeUndefined()
    const antes = Date.now() / 1000
    expect((await llamar(b, 'POST', '/api/parte/visto')).status).toBe(200)
    const guardado = Number(s.store.meta(`parte:${c}`))
    expect(guardado >= antes - 1 && guardado <= Date.now() / 1000 + 1).toBe(true)
    const act = b.oficinas.activa()!
    const ahoraD = new Date()
    expect(Parte.desdeEfectivo(s, c, undefined, ahoraD).getTime() / 1000).toBeCloseTo(guardado, 3)
    const pedido = new Date(1_000_000_000_000)
    expect(Parte.desdeEfectivo(s, c, pedido, ahoraD)).toBe(pedido)
    for (const malo of ['abc', '-5', '0', String(Date.now() / 1000 + 10_000)]) {
      s.store.fijarMeta(`parte:${c}`, malo)
      expect(Math.abs(ahoraD.getTime() - Parte.desdeEfectivo(s, c, undefined, ahoraD).getTime() - 86_400_000)).toBeLessThan(1)
    }
    // en milisegundos también se entiende
    const ms = (await llamar(b, 'GET', '/api/parte', undefined, { desde: String(Date.now() + 5000) }))
    expect(ms.status).toBe(200)
    expect(Parte.fecha(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(Programacion.iso(ahoraD)).toMatch(/Z$/)
    expect(act.carpeta).toBe(c)
  })

  test('consigna del parte narrado: lleva los datos, sin el narrado, y se corta en 15000', () => {
    const o = { version: 1, nombre: 'O', duenio: 'Ana', departamentos: [], agentes: [] }
    const c = Parte.consigna(o, { a: 1, narrado: { texto: 'viejo' } })
    // qué escribir va como mensaje de sistema; en la charla, solo los datos
    expect(c.sistema).toContain('para Ana')
    expect(c.mensaje).toBe('Los datos del parte:\n{"a":1}')
    expect(c.mensaje).not.toContain('viejo')
    expect(Parte.consigna({ ...o, duenio: '' }, {}).sistema).toContain('para la persona')
    const grande = Parte.consigna(o, { x: 'y'.repeat(20000) }).mensaje
    expect(grande).toContain('…')
    expect(grande.length).toBeLessThan(15000 + 1000)
  })
})
