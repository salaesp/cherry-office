// Port de app/Tests/BackendTests/TareasTests.swift.
// Tareas programadas (Fase 5): lógica pura de horarios, validación del modelo, rutas, ejecución y programador.
//
// Sin acceso a internals: la lógica pura (Programacion.*, Validar.oficina, decodificación de Oficina), todo lo que usa el
// reloj del programador (`revisar()` / `fijarReloj`) y la tabla `ejecuciones` están en test/unit/tareas.test.ts. Los ganchos
// (`alTerminar`, `avisos.alCrear`) se omiten en los tests de abajo (comentarios `interno`).
import fs from 'node:fs'
import { describe, expect, test } from 'vitest'
import { Fix, Sandbox, esperar, dict, historial, lista, llamar, msgs, sinPrivate, str, type Obj, ruta, regla } from '../support/sandbox.js'

const ba = 'America/Argentina/Buenos_Aires'
const ny = 'America/New_York'
const zonaDelSistema = Intl.DateTimeFormat().resolvedOptions().timeZone
// Swift (`TimeZone.current.identifier`) puede dar un alias («America/Buenos_Aires») y Node el nombre canónico: se compara la zona canónica.
const canonica = (z: string) => { try { return Intl.DateTimeFormat('en', { timeZone: z }).resolvedOptions().timeZone } catch { return z } }
const esUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const fecha = (s: string) => { const t = Date.parse(s); return Number.isNaN(t) ? null : t }

describe('Tareas programadas (API y programador)', () => {
  /** Oficina con Marce y Nico; el bucle del programador apagado. */
  const fix = () => Fix.crear({ deps: ['Dirección'], agentes: [{ id: 'marce', depto: 'direccion', rol: 'Directora' }, { id: 'nico', depto: 'direccion', rol: 'Ads' }], env: { HQ_PROGRAMADOR: '0' } })

  const nueva = (f: Fix, extra: Obj = {}) =>
    f.post('/api/tareas', { agente: 'marce', nombre: 'Informe diario', consigna: 'Armá el informe de ayer', dias: [1, 2, 3, 4, 5], hora: '08:00', zona: ba, ...extra })

  const ejecuciones = async (f: Fix, id: string): Promise<Obj[]> => lista((await f.get(`/api/tareas/${id}/ejecuciones`)).obj.ejecuciones)

  /** Espera a que la última ejecución de la tarea deje de estar «corriendo» y la devuelve. */
  async function terminada(f: Fix, id: string, cuantas = 1): Promise<Obj> {
    await esperar(async () => {
      const e = await ejecuciones(f, id)
      return e.length >= cuantas && e[0] !== undefined && str(e[0].estado) !== 'corriendo'
    }, 15)
    return (await ejecuciones(f, id))[0] ?? {}
  }

  // MARK: CRUD

  test('crear: guarda en oficina.json, devuelve proxima y zona; sin zona toma la del sistema', async () => {
    const f = await fix()
    const r = await nueva(f)
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    const t = dict(r.obj.tarea)
    expect(str(t.id)).toBe('informe-diario')
    expect(t.dias).toEqual([1, 2, 3, 4, 5])
    expect(str(t.zona)).toBe(ba)
    expect(t.activa).toBe(true)
    expect(fecha(str(t.proxima))).not.toBeNull()
    expect(t.ultima).toBeNull()
    expect(str(t.creada)).not.toBe('')
    const enDisco = lista(f.oficinaJSON().tareas)
    expect(enDisco.length).toBe(1)
    expect(str(enDisco[0]!.consigna)).toBe('Armá el informe de ayer')

    const sinZona = await f.post('/api/tareas', { agente: 'nico', nombre: 'Otra', consigna: 'x', dias: [7], hora: '21:30' })
    expect(sinZona.status).toBe(200)
    expect(canonica(str(dict(sinZona.obj.tarea).zona))).toBe(canonica(zonaDelSistema))

    const l = await f.get('/api/tareas')
    expect(l.status).toBe(200)
    expect(lista(l.obj.tareas).map((x) => str(x.id))).toEqual(['informe-diario', 'otra'])
    // mismo nombre: id distinto
    expect(str(dict((await nueva(f)).obj.tarea).id)).toBe('informe-diario-2')
  })

  test('crear: validaciones (400), agente inexistente (404), id repetido (409), tope de 50 por hacer (las hechas no cuentan)', async () => {
    const f = await fix()
    const malo = async (extra: Obj, estado = 400) => {
      const r = await nueva(f, extra)
      expect(r.status, `${JSON.stringify(extra)} -> ${r.status} ${JSON.stringify(r.obj)}`).toBe(estado)
      expect(str(r.obj.error)).not.toBe('')
    }
    await malo({ dias: [] })
    await malo({ dias: [0] })
    await malo({ dias: [8] })
    await malo({ dias: [1, 1] })
    await malo({ dias: 'lunes' })
    await malo({ dias: [true] })
    await malo({ hora: '8:00' })
    await malo({ hora: '24:00' })
    await malo({ hora: '07:75' })
    await malo({ hora: 800 })
    await malo({ zona: 'Marte/Base' })
    await malo({ consigna: '' })
    await malo({ consigna: 'x'.repeat(4001) })
    await malo({ nombre: ' ' })
    await malo({ activa: 'si' })
    await malo({ id: 'Con Espacios' })
    await malo({ agente: 'nadie' }, 404)
    expect((await f.post('/api/tareas', { agente: 'marce' })).status).toBe(400)
    expect((await llamar(f.b, 'POST', '/api/tareas', { body: 'no json' })).status).toBe(400)
    expect((await llamar(f.b, 'POST', '/api/tareas')).status).toBe(400)
    expect((await nueva(f, { id: 'fija' })).status).toBe(200)
    await malo({ id: 'fija' }, 409)
    for (let i = 1; i < 50; i++) expect((await nueva(f, { nombre: `T${i}` })).status).toBe(200)
    expect(lista(f.oficinaJSON().tareas).length).toBe(50)
    await malo({})
    expect(lista(f.oficinaJSON().tareas).length).toBe(50)
    // una de una sola vez que ya se hizo no cuenta: libera lugar
    const o = f.oficinaJSON()
    const ts = lista(o.tareas)
    Object.assign(ts[0]!, { dias: [], fecha: '2026-11-20', hecha: '2026-11-20T11:00:00Z', activa: false })
    fs.writeFileSync(f.ruta('oficina.json'), JSON.stringify(o))
    expect((await nueva(f, { nombre: 'Entra' })).status).toBe(200)
    expect(lista(f.oficinaJSON().tareas).length).toBe(51)
    await malo({})
    // reactivar la hecha (cambiarle la fecha) también choca con el tope
    const id = str(ts[0]!.id)
    expect((await f.patch(`/api/tareas/${id}`, { fecha: '2099-01-01' })).status).toBe(400)
  })

  test('editar: parcial, valida igual, 404 si no existe; el horario o reactivar fijan «desde»', async () => {
    const f = await fix()
    await nueva(f)
    const r = await f.patch('/api/tareas/informe-diario', { nombre: 'Informe de la mañana', hora: '09:15', dias: [1, 3, 5], activa: false })
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    const t = dict(r.obj.tarea)
    expect(str(t.nombre)).toBe('Informe de la mañana')
    expect(str(t.hora)).toBe('09:15')
    expect(t.dias).toEqual([1, 3, 5])
    expect(t.activa).toBe(false)
    expect(t.proxima, 'una tarea en pausa no tiene próxima corrida').toBeNull()
    expect(str(lista(f.oficinaJSON().tareas)[0]!.consigna), 'lo que no se manda no cambia').toBe('Armá el informe de ayer')
    const react = await f.patch('/api/tareas/informe-diario', { activa: true, zona: ny })
    expect(react.status).toBe(200)
    expect(fecha(str(dict(react.obj.tarea).proxima))).not.toBeNull()
    expect(str(dict(react.obj.tarea).zona)).toBe(ny)
    expect(lista(f.oficinaJSON().tareas)[0]!.desde).toBeDefined()
    expect((await f.patch('/api/tareas/informe-diario', { hora: '99:00' })).status).toBe(400)
    expect((await f.patch('/api/tareas/informe-diario', { zona: 'x/y' })).status).toBe(400)
    expect((await f.patch('/api/tareas/informe-diario', { dias: [] })).status).toBe(400)
    expect((await f.patch('/api/tareas/informe-diario', { consigna: 'x'.repeat(4001) })).status).toBe(400)
    expect((await f.patch('/api/tareas/no-existe', { nombre: 'x' })).status).toBe(404)
    expect((await f.patch('/api/tareas/Mal Id', { nombre: 'x' })).status).toBe(404)
    expect((await llamar(f.b, 'PATCH', '/api/tareas/informe-diario')).status).toBe(400)
    expect((await llamar(f.b, 'PUT', '/api/tareas/informe-diario')).status).toBe(405)
  })

  test('una tarea que termina bien deja una entrega sin revisar (no un aviso) y avisa al canal de notificaciones', async () => {
    const f = await fix()
    // interno (unit test del port): el callback `avisos.alCrear` (canal de notificaciones nativas) recibe "entrega:Marce" (aviso tipo «entrega», nombre del agente).
    await nueva(f)
    expect((await f.post('/api/tareas/informe-diario/correr')).status).toBe(202)
    await terminada(f, 'informe-diario')
    const ok = await esperar(async () => lista((await f.get('/api/entregas')).obj.entregas).length > 0)
    expect(ok).toBe(true)
    const e = lista((await f.get('/api/entregas')).obj.entregas)[0] ?? {}
    expect(str(e.agente)).toBe('marce')
    expect(str(e.origen)).toBe('tarea')
    expect(str(e.ref)).toBe('informe-diario')
    expect(str(e.estado)).toBe('sin_revisar')
    expect(str(e.sid)).not.toBe('')
    expect(lista((await f.get('/api/avisos')).obj.avisos).some((a) => str(a.tipo) === 'tarea')).toBe(false)
  })

  test('borrar: saca la tarea y sus ejecuciones; 404 si no existe', async () => {
    const f = await fix()
    await nueva(f)
    const c = await f.post('/api/tareas/informe-diario/correr')
    expect(c.status).toBe(202)
    await terminada(f, 'informe-diario')
    const d = await f.delete('/api/tareas/informe-diario')
    expect(d.status).toBe(200)
    expect(d.obj.ok).toBe(true)
    expect(lista((await f.get('/api/tareas')).obj.tareas)).toEqual([])
    expect(f.oficinaJSON().tareas).toBeUndefined()
    expect((await f.get('/api/tareas/informe-diario/ejecuciones')).status).toBe(404)
    expect((await f.delete('/api/tareas/informe-diario')).status).toBe(404)
    // si se vuelve a crear con el mismo id no hereda historial
    await nueva(f)
    expect(await ejecuciones(f, 'informe-diario')).toEqual([])
  })

  test('despedir al agente desactiva sus tareas (no las borra) y no se pueden reactivar', async () => {
    const f = await fix()
    await nueva(f)
    await nueva(f, { agente: 'nico', nombre: 'De Nico' })
    expect((await f.delete('/api/agentes/marce')).status).toBe(200)
    const ts = lista((await f.get('/api/tareas')).obj.tareas)
    expect(ts.length).toBe(2)
    const marce = ts.find((x) => str(x.id) === 'informe-diario')!
    expect(marce).toBeDefined()
    expect(marce.activa).toBe(false)
    expect(marce.proxima).toBeNull()
    expect(ts.find((x) => str(x.id) === 'de-nico')?.activa).toBe(true)
    expect((await f.patch('/api/tareas/informe-diario', { activa: true })).status).toBe(409)
    expect((await f.post('/api/tareas/informe-diario/correr')).status).toBe(409)
    // oficina.json sigue siendo válido y se puede volver a leer
    expect((await f.get('/api/oficina')).status).toBe(200)
  })

  test('sin oficina abierta: 409', async () => {
    const sin = await new Sandbox().backend({ env: { HQ_PROGRAMADOR: '0' }, oficina: false })
    expect((await llamar(sin, 'GET', '/api/tareas')).status).toBe(409)
    const cuerpo = { agente: 'a', nombre: 'n', consigna: 'c', dias: [1], hora: '08:00' }
    expect((await llamar(sin, 'POST', '/api/tareas', { body: cuerpo })).status).toBe(409)
    expect((await llamar(sin, 'POST', '/api/tareas/x/correr')).status).toBe(409)
  })

  // MARK: ejecución

  test('probar ahora: 202 con la ejecución; corre al agente con sus permisos en una sesión nueva; queda ok con costo', async () => {
    const f = await fix()
    await nueva(f, { consigna: 'Armá el informe' })
    // interno (unit test del port): el gancho `programador.alTerminar` se llama una vez con la ejecución (estado «ok», tarea «informe-diario»).
    const r = await f.post('/api/tareas/informe-diario/correr')
    expect(r.status, JSON.stringify(r.obj)).toBe(202)
    const ej = dict(r.obj.ejecucion)
    expect(str(ej.estado)).toBe('corriendo')
    expect(ej.manual).toBe(true)
    expect(str(ej.agente)).toBe('marce')
    expect(str(ej.tarea)).toBe('informe-diario')
    const sid = str(ej.sid)
    expect(esUUID(sid)).toBe(true)

    const fin = await terminada(f, 'informe-diario')
    expect(str(fin.estado), JSON.stringify(fin)).toBe('ok')
    expect(str(fin.resultado)).toBe('hola marce')
    expect(Math.abs(((fin.costo as number) ?? 0) - 0.01)).toBeLessThan(1e-9)
    expect(fin.fin).not.toBeNull()
    expect(fin.error).toBeNull()
    expect(str(fin.sid)).toBe(sid)

    // el pedido y la respuesta quedaron como un chat más
    const h = await historial(f.b, { agent: 'marce', session: sid })
    expect(msgs(h).map((m) => str(m.r))).toEqual(['u', 'a'])
    expect(msgs(h).map((m) => str(m.t))).toEqual(['Armá el informe', 'hola marce'])
    expect(str((await historial(f.b, { agent: 'marce' })).obj.session), 'es la última sesión del agente').toBe(sid)
    // con los permisos y la carpeta del agente
    const l = f.sb.llamadas.at(-1)!
    expect(l).toBeDefined()
    expect(Sandbox.valor(l, '--agent')).toBe('marce')
    expect(Sandbox.valor(l, '--session-id')).toBe(sid)
    expect(Sandbox.reglas(l)).toContain(regla('Edit', ruta(f.carpeta, 'conocimiento/agentes/marce.md')))
    expect(sinPrivate(f.sb.cwds.at(-1)!)).toBe(sinPrivate(f.carpeta))
    // costo con origen «tarea» y la tarea como referencia
    const c = await f.get('/api/costos')
    expect(Math.abs(((dict(c.obj.origenes).tarea as number) ?? 0) - 0.01)).toBeLessThan(1e-9)
    expect(Math.abs(((dict(c.obj.agentes).marce as number) ?? 0) - 0.01)).toBeLessThan(1e-9)
    // en la lista aparece como última
    const t = dict(lista((await f.get('/api/tareas')).obj.tareas)[0])
    expect(str(dict(t.ultima).estado)).toBe('ok')
    expect(t.corriendo).toBe(false)
  })

  test('permisos pendientes: lo que la tarea no pudo hacer queda como pedido; al responder retoma la conversación y recién ahí entrega', async () => {
    const f = await fix()
    await nueva(f, { consigna: 'DENEGAR:git pull origin main' })
    const pendientes = async (): Promise<Obj[]> => lista((await f.get('/api/actividad')).obj.permisos)
    expect((await f.post('/api/tareas/informe-diario/correr')).status).toBe(202)
    // frena: «esperando_permiso», sin entrega, con un pedido por comando (sin repetir; los conectores no se anotan)
    expect(await esperar(async () => str((await ejecuciones(f, 'informe-diario'))[0]?.estado) === 'esperando_permiso', 15)).toBe(true)
    // la corrida ve Bash, Edit y Write (para que el rechazo quede anotado) y sigue en dontAsk
    const l0 = f.sb.llamadas.at(-1)!
    expect(Sandbox.valor(l0, '--tools')?.split(',')).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write']))
    expect(Sandbox.valor(l0, '--permission-mode')).toBe('dontAsk')
    const ps = await pendientes()
    expect(ps.length).toBe(1)
    const p = ps[0]!
    expect([str(p.agente), str(p.herramienta), str(p.detalle), str(p.tarea)]).toEqual(['marce', 'Bash', 'git pull origin main', 'Informe diario'])
    expect(p.reglas).toEqual(['Bash(git pull:*)'])
    expect(lista((await f.get('/api/entregas')).obj.entregas)).toEqual([])
    const av = lista((await f.get('/api/avisos')).obj.avisos).find((a) => str(a.tipo) === 'permiso')
    expect(str(av?.texto)).toContain('Informe diario')
    // mientras espera no se puede volver a lanzar
    expect((await f.post('/api/tareas/informe-diario/correr')).status).toBe(409)
    const llamadas = f.sb.llamadas.length

    // «Una vez»: retoma la misma sesión con el comando permitido solo para esa vuelta
    const r = await f.post(`/api/permisos/${str(p.id)}`, { decision: 'una_vez' })
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    expect(r.obj.retoma).toBe(true)
    expect(await pendientes()).toEqual([])
    const fin = await terminada(f, 'informe-diario')
    expect(str(fin.estado), JSON.stringify(fin)).toBe('ok')
    expect(str(fin.resultado)).toBe('Listo: corrí el comando y terminé.')
    expect(Math.abs(((fin.costo as number) ?? 0) - 0.03)).toBeLessThan(1e-9)   // las dos vueltas
    const l1 = f.sb.llamadas.at(-1)!
    expect(f.sb.llamadas.length).toBe(llamadas + 1)
    expect(Sandbox.valor(l1, '--resume')).toBe(str(fin.sid))
    expect(Sandbox.reglas(l1)).toContain('Bash(git pull:*)')
    expect((l1.at(-1) ?? '').normalize('NFC')).toContain('git pull origin main')
    // no quedó guardado en el agente (fue una vez) y la entrega salió al final
    const marce = lista(f.oficinaJSON().agentes).find((a) => str(a.id) === 'marce')
    expect(marce?.reglas).toBeUndefined()
    expect(await esperar(async () => lista((await f.get('/api/entregas')).obj.entregas).length === 1)).toBe(true)
    expect(str(lista((await f.get('/api/entregas')).obj.entregas)[0]?.resumen)).toContain('Listo')
    // un pedido ya respondido no existe más
    expect((await f.post(`/api/permisos/${str(p.id)}`, { decision: 'una_vez' })).status).toBe(404)
  })

  test('permisos pendientes: «Siempre» guarda la regla en el agente; «No» retoma igual avisando que no', async () => {
    const f = await fix()
    await nueva(f, { consigna: 'DENEGAR:npm install' })
    const pendientes = async (): Promise<Obj[]> => lista((await f.get('/api/actividad')).obj.permisos)
    expect((await f.post('/api/tareas/informe-diario/correr')).status).toBe(202)
    expect(await esperar(async () => (await pendientes()).length === 1, 15)).toBe(true)
    expect((await f.post(`/api/permisos/${str((await pendientes())[0]!.id)}`, { decision: 'siempre' })).status).toBe(200)
    expect(str((await terminada(f, 'informe-diario')).estado)).toBe('ok')
    expect(lista(f.oficinaJSON().agentes).find((a) => str(a.id) === 'marce')?.reglas).toEqual(['Bash(npm install:*)'])

    await nueva(f, { nombre: 'Otra', consigna: 'DENEGAR:make build' })
    expect((await f.post('/api/tareas/otra/correr')).status).toBe(202)
    expect(await esperar(async () => (await pendientes()).length === 1, 15)).toBe(true)
    expect((await f.post(`/api/permisos/${str((await pendientes())[0]!.id)}`, { decision: 'rechazar' })).status).toBe(200)
    expect(str((await terminada(f, 'otra')).estado)).toBe('ok')
    const ult = (f.sb.llamadas.at(-1)!.at(-1) ?? '').normalize('NFC')
    expect(ult).toContain('No te dio permiso')
    expect(Sandbox.reglas(f.sb.llamadas.at(-1)!)).not.toContain('Bash(make build:*)')
  })

  test('tarea repetida: la corrida siguiente arranca de cero pero con lo que entregó la vez anterior', async () => {
    const f = await fix()
    await nueva(f, { consigna: 'Armá el informe' })
    expect((await f.post('/api/tareas/informe-diario/correr')).status).toBe(202)
    await terminada(f, 'informe-diario')
    const primera = f.sb.llamadas.at(-1)!
    expect(primera.at(-1)).toBe('Armá el informe')
    expect((await f.post('/api/tareas/informe-diario/correr')).status).toBe(202)
    await esperar(() => f.sb.llamadas.length > 1 && f.sb.llamadas.at(-1)!.some((x) => x.includes('# La vez anterior')))
    const segunda = f.sb.llamadas.at(-1)!
    // en la charla queda solo la consigna; lo de la vez anterior va como mensaje de sistema
    expect(segunda.at(-1)).toBe('Armá el informe')
    const sistema = segunda[segunda.indexOf('--append-system-prompt') + 1]!
    expect(sistema).toContain('# La vez anterior\nEsta tarea ya corrió (')
    expect(sistema.endsWith(':\nhola marce')).toBe(true)
    expect(segunda.includes('--session-id') && !segunda.includes('--resume')).toBe(true)
  })

  test('probar ahora: la actividad muestra origen «tarea» con el nombre; no se puede lanzar ni borrar mientras corre (409)', async () => {
    const f = await fix()
    await nueva(f, { consigna: 'STREAM PAUSA informe' })
    const r = await f.post('/api/tareas/informe-diario/correr')
    expect(r.status).toBe(202)
    const viendo = await esperar(async () => {
      const a = await f.get('/api/actividad')
      return dict(dict(a.obj.agentes).marce).origen === 'tarea'
    })
    expect(viendo).toBe(true)
    const m = dict(dict((await f.get('/api/actividad')).obj.agentes).marce)
    expect(str(m.tarea)).toBe('Informe diario')
    expect((await f.post('/api/tareas/informe-diario/correr')).status).toBe(409)
    expect((await f.delete('/api/tareas/informe-diario')).status).toBe(409)
    expect(dict(lista((await f.get('/api/tareas')).obj.tareas)[0]).corriendo).toBe(true)
    f.sb.abrirPuerta()
    const fin = await terminada(f, 'informe-diario')
    expect(str(fin.estado)).toBe('ok')
    expect(str(fin.resultado)).toBe('stream marce')
    expect(Math.abs(((fin.costo as number) ?? 0) - 0.25)).toBeLessThan(1e-9)
    expect(dict((await f.get('/api/actividad')).obj.agentes)).toEqual({})
  })

  test('una corrida que falla queda en error con el motivo, y el chat guarda el error', async () => {
    const f = await fix()
    await nueva(f, { consigna: 'ISERR por favor' })
    // interno (unit test del port): el gancho `programador.alTerminar` se llama una vez con la ejecución (estado «error»).
    expect((await f.post('/api/tareas/informe-diario/correr')).status).toBe(202)
    const fin = await terminada(f, 'informe-diario')
    expect(str(fin.estado), JSON.stringify(fin)).toBe('error')
    expect(str(fin.error)).not.toBe('')
    const m = msgs(await historial(f.b, { agent: 'marce', session: str(fin.sid) }))
    expect(m.length).toBe(2)
    expect(m[1]!.e).toBe(true)
  })
  // MARK: una sola vez

  const nuevaUnica = (f: Fix, extra: Obj = {}) =>
    f.post('/api/tareas', { agente: 'marce', nombre: 'Propuesta', consigna: 'Armá la propuesta', tipo: 'unica', fecha: '2099-03-10', hora: '09:00', zona: ba, ...extra })

  test('una sola vez: se crea con fecha (sin días), tiene próxima y «cuando»; valida fecha y tipo', async () => {
    const f = await fix()
    const r = await nuevaUnica(f)
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    const t = dict(r.obj.tarea)
    expect(str(t.tipo)).toBe('unica')
    expect(str(t.fecha)).toBe('2099-03-10')
    expect(t.dias).toEqual([])
    expect(t.hecha).toBeNull()
    expect(fecha(str(t.proxima))).toBe(fecha(str(t.cuando)))
    expect(fecha(str(t.cuando))).toBe(fecha('2099-03-10T09:00:00-03:00'))
    expect(str(lista(f.oficinaJSON().tareas)[0]!.fecha)).toBe('2099-03-10')
    // las repetidas siguen igual y dicen su tipo
    expect(str(dict((await nueva(f)).obj.tarea).tipo)).toBe('repetida')
    for (const malo of [{ fecha: '2099-02-30' }, { fecha: 'mañana' }, { fecha: null }, { tipo: 'a veces' }, { hora: '9' }, { ahora: 'si' }, { tipo: 'repetida', ahora: true, dias: [1] }]) {
      const m = await nuevaUnica(f, malo)
      expect(m.status, `${JSON.stringify(malo)} -> ${m.status} ${JSON.stringify(m.obj)}`).toBe(400)
    }
    // sin «tipo», la fecha alcanza
    const sinTipo = await f.post('/api/tareas', { agente: 'marce', nombre: 'X', consigna: 'c', fecha: '2099-01-01', hora: '10:00' })
    expect(str(dict(sinTipo.obj.tarea).tipo)).toBe('unica')
  })

  test('una sola vez «ahora»: arranca enseguida como su corrida programada, deja una entrega y queda hecha y en pausa', async () => {
    const f = await fix()
    const r = await f.post('/api/tareas', { agente: 'marce', nombre: 'Propuesta', consigna: 'Armá la propuesta', tipo: 'unica', ahora: true })
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    const id = str(dict(r.obj.tarea).id)
    const fin = await terminada(f, id)
    expect(str(fin.estado)).toBe('ok')
    expect(fin.manual).toBe(false)
    const hecha = await esperar(async () => typeof dict((await f.get(`/api/tareas/${id}`)).obj.tarea).hecha === 'string')
    expect(hecha).toBe(true)
    const t = dict((await f.get(`/api/tareas/${id}`)).obj.tarea)
    expect(t.activa).toBe(false)
    expect(t.proxima).toBeNull()
    const es = lista((await f.get('/api/entregas')).obj.entregas).filter((e) => str(e.ref) === id)
    expect(es.length).toBe(1)
    expect(str(es[0]!.origen)).toBe('tarea')
    // el programador no la vuelve a correr
    // interno (unit test del port): Swift llamaba antes a `programador.revisar()` (un tick a mano); aquí el bucle está apagado, así que solo se comprueba que sigue en 1.
    expect((await ejecuciones(f, id)).length).toBe(1)
    // reactivarla sin cambiar la fecha: 409; cambiando la hora vuelve a estar pendiente
    expect((await f.patch(`/api/tareas/${id}`, { activa: true })).status).toBe(409)
    const mov = await f.patch(`/api/tareas/${id}`, { fecha: '2099-05-01', hora: '10:00' })
    expect(mov.status, JSON.stringify(mov.obj)).toBe(200)
    const m = dict(mov.obj.tarea)
    expect(m.hecha).toBeNull()
    expect(m.activa).toBe(true)
    expect(fecha(str(m.proxima))).not.toBeNull()
  })
  test('editar: pasar de repetida a una sola vez y al revés pide fecha o días', async () => {
    const f = await fix()
    await nueva(f)
    expect((await f.patch('/api/tareas/informe-diario', { tipo: 'unica' })).status).toBe(400)
    expect((await f.patch('/api/tareas/informe-diario', { fecha: '2099-01-01', dias: [1] })).status).toBe(400)
    const u = await f.patch('/api/tareas/informe-diario', { tipo: 'unica', fecha: '2099-01-01' })
    expect(u.status).toBe(200)
    expect(str(dict(u.obj.tarea).tipo)).toBe('unica')
    expect(dict(u.obj.tarea).dias).toEqual([])
    expect((await f.patch('/api/tareas/informe-diario', { dias: [1, 2] })).status, 'con días vuelve a repetirse').toBe(200)
    const r = dict((await f.get('/api/tareas/informe-diario')).obj.tarea)
    expect(str(r.tipo)).toBe('repetida')
    expect(r.fecha).toBeUndefined()
    expect(r.dias).toEqual([1, 2])
    expect((await f.patch('/api/tareas/informe-diario', { tipo: 'repetida' })).status, 'ya era repetida').toBe(200)
    expect((await f.patch('/api/tareas/informe-diario', { tipo: 'repetida', fecha: '2099-01-01' })).status).toBe(400)
  })
})
