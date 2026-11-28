// Port de app/Tests/BackendTests/GobiernoTests.swift.
// Gobierno: instrucciones inyectadas (reglas, límites, conectores), conectores por agente y acciones aprobadas por la persona.
// Siempre con el claude falso: nunca se toca la cuenta real.
//
// Diferencias con Swift (caja negra por HTTP):
// - Los tests de funciones puras (Instrucciones.para, Conectores.parsearInit/clasificar, ConectoresAgente.herramientas) son internos: skip.
// - `CatalogoConectores.compartido.fijar(...)` se reemplaza por la detección real: un claude que emite `system/init`
//   cuando le piden «Respondé solo: ok» (ver `claudeMezcla`) y POST /api/conectores/actualizar.
// - `proponer_accion` no se llama con un token emitido a mano: se hace desde un chat del agente con el claude falso
//   (CREADOR_LLAMAR), que llama al servidor MCP con el token real de esa corrida.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { Fix, Sandbox, U, chat, codigoClaudeFalso, dict, dormir, esperar, existe, leerTexto, lista, llamar, scriptNode, str, type Obj } from '../support/sandbox.js'

const leerCal = 'mcp__claude_ai_Google_Calendar__list_events'
const verCal = 'mcp__claude_ai_Google_Calendar__get_event'
const crearCal = 'mcp__claude_ai_Google_Calendar__create_event'
const leerMail = 'mcp__claude_ai_Gmail__search_threads'
const enviarMail = 'mcp__claude_ai_Gmail__send_message'

type Ag = { id: string; depto: string; rol?: string }

const fix = (agentes: Ag[] = [{ id: 'marce', depto: 'direccion', rol: 'Directora' }], sb?: Sandbox) =>
  Fix.crear({ deps: ['Dirección'], agentes, env: { HQ_PROGRAMADOR: '0' }, sb })

const conectoresCalendar = (actuar = true): Obj => ({ servidor: 'Google Calendar', leer: [leerCal, verCal], actuar: actuar ? [crearCal] : [] })

async function asignar(f: Fix, conectores: Obj[], agente = 'marce') {
  const r = await f.patch(`/api/agentes/${agente}`, { conectores })
  if (r.status !== 200) throw new Error(`asignar conectores: ${JSON.stringify(r.obj)}`)
}

/** PUT /api/reglas con reglas dadas (atajo de los tests). */
const llamarReglas = (f: Fix, reglas: Obj[]) => llamar(f.b, 'PUT', '/api/reglas', { body: { reglas } })

// Swift (Foundation) pasa los argumentos de proceso en NFD en macOS: se normalizan a NFC para comparar texto con tildes.
const nfc = (l: string[]) => l.map((x) => x.normalize('NFC'))
const ultima = (f: Fix) => nfc(f.sb.llamadas.at(-1)!)
const conPrompt = (f: Fix, t: string) => f.sb.llamadas.map(nfc).filter((a) => (a.at(-1) ?? '').includes(t))

const initCatalogo = String.raw`{"type":"system","subtype":"init","mcp_servers":[{"name":"claude.ai Google Calendar","status":"connected","source":"claudeai"},{"name":"claude.ai Gmail","status":"connected","source":"claudeai"},{"name":"hq","status":"connected","source":"project"}],"tools":["Read","${leerCal}","${verCal}","${crearCal}","${leerMail}","${enviarMail}","mcp__hq__colegas"]}`

/**
 * Deja en el sandbox un `claude` que responde con el `system/init` del catálogo de Swift (Calendar y Gmail conectados)
 * cuando es la corrida de detección («Respondé solo: ok») y en cualquier otro caso delega en el claude falso común.
 */
function claudeMezcla(sb: Sandbox) {
  fs.writeFileSync(path.join(sb.binDir, 'claude-base.cjs'), codigoClaudeFalso())
  scriptNode(sb.bin.replace(/\.cjs$/, ''), `const fs = require('node:fs')
const path = require('node:path')
const a = process.argv.slice(2)
let msg
if (a.includes('--')) msg = a[a.length - 1]
else { msg = fs.readFileSync(0, 'utf8'); globalThis.__hqMensajeStdin = msg }
if (msg.normalize('NFC').endsWith('solo: ok')) {
  process.stdout.write(${JSON.stringify(initCatalogo)} + '\\n')
  process.stdout.write('{"type":"result","result":"ok","is_error":false}\\n')
} else {
  require(path.join(__dirname, 'claude-base.cjs'))
}
`)
}

/** Un claude falso que emite un `system/init` con conectores y anota sus argumentos y el entorno. */
function claudeConInit(sb: Sandbox): string {
  return scriptNode(`${sb.root}/bin/claude-init`, String.raw`const fs = require('node:fs')
const path = require('node:path')
const D = path.dirname(fs.realpathSync(process.argv[1]))
let a = process.argv.slice(2)
if (a[0] === 'auth') { process.stdout.write('{"loggedIn":true}\n'); return }
if (!a.includes('--')) a = [...a, '--', fs.readFileSync(0, 'utf8')]
fs.appendFileSync(path.join(D, 'det.log'), a.map((x) => x + '\x1f').join(''))
fs.appendFileSync(path.join(D, 'det.log'), 'NB=' + (process.env.MCP_CONNECTION_NONBLOCKING || '-') + '\n')
process.stdout.write('{"type":"system","subtype":"hook_started"}\n')
process.stdout.write('{"type":"system","subtype":"init","mcp_servers":[{"name":"claude.ai Google Calendar","status":"connected","source":"claudeai"},{"name":"claude.ai Gmail","status":"needs-auth","source":"claudeai"},{"name":"hq","status":"connected","source":"project"}],"tools":["Read","mcp__claude_ai_Google_Calendar__list_events","mcp__claude_ai_Google_Calendar__create_event","mcp__hq__colegas"]}\n')
process.stdout.write('{"type":"result","result":"ok","is_error":false}\n')
`)
}

type Propuesta = { esError: boolean; texto: string }

/**
 * Llama a `proponer_accion` como lo haría el agente: un chat con el claude falso que hace las llamadas MCP con el token de esa corrida.
 * Devuelve el resultado de cada llamada (una sola corrida para todas: comparten el cupo).
 */
async function proponerVarias(f: Fix, llamadas: Obj[], agente = 'marce'): Promise<Propuesta[]> {
  const antes = f.sb.salidasCreador.length
  f.sb.llamadasCreador(llamadas.map((arguments_) => ({ name: 'proponer_accion', arguments: arguments_ })))
  const r = await chat(f.b, { agent: agente, message: 'CREADOR_LLAMAR', session: randomUUID() })
  if (r.status !== 200) throw new Error(`chat: ${JSON.stringify(r.obj)}`)
  const salidas = f.sb.salidasCreador.slice(antes)
  expect(salidas.length, `salidas MCP: ${JSON.stringify(salidas)}`).toBe(llamadas.length)
  return salidas.map((s) => {
    const res = dict(s.result)
    const texto = lista(res.content).map((c) => str(c.text)).join('\n') || JSON.stringify(s.error ?? s)
    return { esError: res.isError === true || s.error !== undefined, texto }
  })
}

async function proponer(f: Fix, {
  agente = 'marce', herramienta = crearCal, resumen = 'Crear la reunión del lunes',
  detalle = { titulo: 'Reunión', fecha: '2026-11-16' } as unknown,
}: { agente?: string; herramienta?: string; resumen?: string; detalle?: unknown } = {}): Promise<Propuesta> {
  const args: Obj = { herramienta, resumen }
  if (detalle !== undefined) args.detalle = detalle
  return (await proponerVarias(f, [args], agente))[0]!
}

const entregas = async (f: Fix) => lista((await f.get('/api/entregas')).obj.entregas)
const accionDe = async (f: Fix, id: number) => dict((await f.get('/api/acciones', { entrega: String(id) })).obj.accion)
const entregaDe = async (f: Fix, id: number) => dict((await f.get(`/api/entregas/${id}`)).obj.entrega)

describe('Gobierno: instrucciones, conectores y acciones', () => {
  // MARK: instrucciones

  // interno (unit test del port): Instrucciones.para arma reglas, límites, conectores y coordinador
  test.skip('Instrucciones: arma reglas, límites, conectores y coordinador', () => {})
  // interno (unit test del port): Instrucciones.para devuelve nil sin nada; sin dueño dice «la persona»; frase de salida
  test.skip('Instrucciones: nil si no hay nada; sin dueño dice «la persona»; la frase de salida va con límites, actuar o reglas', () => {})
  // interno (unit test del port): Instrucciones.para recorta a 8000 caracteres
  test.skip('Instrucciones: tope de 8000 caracteres', () => {})

  test('un chat con reglas lleva --append-system-prompt', async () => {
    const f = await fix()
    const p = await llamarReglas(f, [{ texto: 'No inventes datos.' }])
    expect(p.status).toBe(200)
    await chat(f.b, { agent: 'marce', message: 'hola', session: U.a })
    const l = ultima(f)
    const i = Sandbox.valor(l, '--append-system-prompt')
    expect(i).toBeDefined()
    expect(i!.includes('## Reglas de la oficina') && i!.includes('No inventes datos.')).toBe(true)
  })

  test('una reunión lleva --append-system-prompt con las reglas', async () => {
    const f = await fix([{ id: 'marce', depto: 'direccion', rol: 'Directora' }, { id: 'nico', depto: 'direccion', rol: 'Analista' }])
    expect((await llamarReglas(f, [{ texto: 'Hablá en voseo.' }])).status).toBe(200)
    const r = await f.post('/api/reuniones', { tema: 'plan', agentes: ['marce', 'nico'] })
    expect([200, 202], JSON.stringify(r.obj)).toContain(r.status)
    expect(await esperar(() => conPrompt(f, 'en una reuni').length > 0, 15)).toBe(true)
    const l = conPrompt(f, 'en una reuni')[0]!
    expect(Sandbox.valor(l, '--append-system-prompt')?.includes('Hablá en voseo.')).toBe(true)
    expect(Sandbox.valor(l, '--disallowedTools')).toBe('mcp__claude_ai_*')
  })

  // MARK: conectores

  // interno (unit test del port): Conectores.parsearInit (servidores de claude.ai, prefijo y herramientas)
  test.skip('parsearInit: servidores de claude.ai, su prefijo y sus herramientas', () => {})
  // interno (unit test del port): Conectores.clasificar y Conectores.corto
  test.skip('clasificar: leer por prefijo (también camelCase), actuar si hay duda', () => {})
  // interno (unit test del port): ConectoresAgente.herramientas con catálogo (permitidas y vedadas)
  test.skip('ConectoresAgente: veda create_event y Gmail; pedir actuar habilita create_event', () => {})
  // interno (unit test del port): ConectoresAgente.herramientas sin catálogo / sin permitidas
  test.skip('ConectoresAgente: sin catálogo no veda nada; sin permitidas veda todos los conectores', () => {})

  test('un chat con conectores asignados: permitidas en --allowedTools, vedados los demás y el entorno de conexión', async () => {
    const sb = new Sandbox()
    claudeMezcla(sb)
    const f = await fix(undefined, sb)
    // el catálogo (Calendar y Gmail conectados) sale de la detección real
    expect((await f.post('/api/conectores/actualizar')).obj.error).toBeUndefined()
    await asignar(f, [conectoresCalendar()])
    await chat(f.b, { agent: 'marce', message: 'hola', session: U.a })
    const l = ultima(f)
    const todas = Sandbox.reglas(l)
    const reglas = todas.slice(0, todas.findIndex((x) => x.startsWith('--')) < 0 ? undefined : todas.findIndex((x) => x.startsWith('--')))
    expect(reglas.includes(leerCal) && reglas.includes(verCal) && !reglas.includes(crearCal)).toBe(true)
    expect(reglas.includes('mcp__hq__proponer_accion')).toBe(true)
    const resto = l.slice(l.indexOf('--disallowedTools') + 1)
    const fin = resto.findIndex((x) => x.startsWith('--'))
    const vedadas = fin < 0 ? resto : resto.slice(0, fin)
    expect(new Set(vedadas)).toEqual(new Set([crearCal, 'mcp__claude_ai_Gmail']))
    expect(Sandbox.valor(l, '--append-system-prompt')?.includes('proponer_accion')).toBe(true)
  })

  test('POST /api/conectores/actualizar detecta con haiku, sin herramientas y sin bloqueo, y GET lo devuelve clasificado', async () => {
    const sb = new Sandbox()
    const b = await sb.backend({ claudePath: claudeConInit(sb) })
    const r = await llamar(b, 'POST', '/api/conectores/actualizar')
    expect(r.status).toBe(200)
    expect(r.obj.error).toBeUndefined()
    expect(r.obj.detectando).toBe(false)
    const s = lista(r.obj.servidores)
    expect(s.map((x) => str(x.nombre))).toEqual(['Google Calendar', 'Gmail'])
    expect(s[0]!.disponible === true && s[1]!.disponible === false).toBe(true)
    const hs = lista(s[0]!.herramientas)
    expect(hs.map((h) => str(h.corto))).toEqual(['list_events', 'create_event'])
    expect(hs.map((h) => str(h.tipo))).toEqual(['leer', 'actuar'])
    expect(str(hs[0]!.nombre)).toBe(leerCal)
    expect(str(r.obj.detectado)).not.toBe('')
    const log = leerTexto(`${sb.binDir}/det.log`)
    expect(log.includes('NB=false')).toBe(true)
    const args = log.split('NB=')[0]!.split('\x1f')
    expect(Sandbox.valor(args, '--model')).toBe('haiku')
    expect(Sandbox.valor(args, '--tools')).toBe('')
    expect(Sandbox.valor(args, '--permission-mode')).toBe('dontAsk')
    expect(args.includes('--output-format') && args.includes('stream-json') && args.includes('--verbose')).toBe(true)
    expect(args.includes('--allowedTools')).toBe(false)
    const g = await llamar(b, 'GET', '/api/conectores')
    expect(lista(g.obj.servidores).length).toBe(2)
  })

  test('GET /api/conectores sin detección previa la lanza una vez en segundo plano; nunca al arrancar', async () => {
    const sb = new Sandbox()
    const b = await sb.backend({ claudePath: claudeConInit(sb) })
    await dormir(300)
    expect(existe(`${sb.binDir}/det.log`), 'arrancar el backend no detecta').toBe(false)
    const g = await llamar(b, 'GET', '/api/conectores')
    expect(g.status).toBe(200)
    expect(g.obj.detectado).toBeNull()
    expect(typeof g.obj.detectando).toBe('boolean')
    expect(await esperar(async () => lista((await llamar(b, 'GET', '/api/conectores')).obj.servidores).length === 2)).toBe(true)
    await llamar(b, 'GET', '/api/conectores')
    const veces = leerTexto(`${sb.binDir}/det.log`).split('NB=').length - 1
    expect(veces).toBe(1)
  })

  test('si la detección falla (sin system/init) devuelve el estado con el error y no toca el catálogo', async () => {
    const f = await fix()
    const r = await f.post('/api/conectores/actualizar')
    expect(r.status).toBe(200)
    expect(str(r.obj.error)).not.toBe('')
    expect(lista(r.obj.servidores)).toEqual([])
    // interno (unit test del port): CatalogoConectores.compartido.servidores() == nil (por HTTP un GET volvería a lanzar la detección)
    expect((await llamar(f.b, 'DELETE', '/api/conectores')).status).toBe(405)
  })

  // MARK: reglas

  test('GET y PUT /api/reglas: ids automáticos, persistencia, vaciar y validaciones (41 reglas dan 400)', async () => {
    const f = await fix()
    let r = await f.get('/api/reglas')
    expect(r.status).toBe(200)
    expect(lista(r.obj.reglas)).toEqual([])
    r = await llamar(f.b, 'PUT', '/api/reglas', {
      body: { reglas: [{ texto: 'No inventes datos', origen: '«No inventar»' }, { id: 'uno', texto: 'Otra regla' }, { texto: 'No inventes datos' }] },
    })
    expect(r.status, JSON.stringify(r.obj)).toBe(200)
    const rs = lista(r.obj.reglas)
    expect(rs.map((x) => str(x.id))).toEqual(['no-inventes-datos', 'uno', 'no-inventes-datos-2'])
    expect(str(rs[0]!.origen)).toBe('«No inventar»')
    expect(lista(f.oficinaJSON().reglas).length).toBe(3)
    expect(lista((await f.get('/api/reglas')).obj.reglas).length).toBe(3)

    const put = (cuerpo: unknown) => llamar(f.b, 'PUT', '/api/reglas', { body: cuerpo })
    const muchas = Array.from({ length: 41 }, (_, i) => ({ texto: `regla ${i}` }))
    expect((await put({ reglas: muchas })).status).toBe(400)
    expect((await put({ reglas: [{ texto: '  ' }] })).status).toBe(400)
    expect((await put({ reglas: [{ texto: 'x'.repeat(601) }] })).status).toBe(400)
    expect((await put({ reglas: [{ id: 'a', texto: 'x' }, { id: 'a', texto: 'y' }] })).status).toBe(409)
    expect((await put({ reglas: [{ id: 'No Valido', texto: 'x' }] })).status).toBe(400)
    expect((await put({ reglas: 'no' })).status).toBe(400)
    expect((await put({ otra: 1 })).status).toBe(400)
    expect((await llamar(f.b, 'PUT', '/api/reglas')).status).toBe(400)
    expect(lista((await f.get('/api/reglas')).obj.reglas).length, 'los pedidos malos no cambian nada').toBe(3)
    expect((await put({ reglas: Array.from({ length: 40 }, (_, i) => ({ texto: `regla ${i}` })) })).status).toBe(200)
    const vacio = await put({ reglas: [] })
    expect(vacio.status).toBe(200)
    expect(lista(vacio.obj.reglas)).toEqual([])
    expect(f.oficinaJSON().reglas).toBeUndefined()
    expect((await llamar(f.b, 'DELETE', '/api/reglas')).status).toBe(405)
  })

  // MARK: acciones

  test('herramientas MCP de acciones: solo con herramientas de actuar asignadas', async () => {
    const f = await fix([{ id: 'marce', depto: 'direccion', rol: 'Directora' }, { id: 'nico', depto: 'direccion', rol: 'Analista' }])
    await asignar(f, [conectoresCalendar()])
    // Acciones.herramientasMCP / HerramientasMCPAgente.lista: lo observable es el --allowedTools de cada chat
    await chat(f.b, { agent: 'marce', message: 'hola', session: U.a })
    await chat(f.b, { agent: 'nico', message: 'hola', session: U.b })
    const [lm, ln] = f.sb.llamadas.slice(-2) as [string[], string[]]
    expect(Sandbox.reglas(lm).includes('mcp__hq__proponer_accion')).toBe(true)
    expect(Sandbox.reglas(ln).includes('mcp__hq__proponer_accion')).toBe(false)
    // Acciones.herramientas(... nico) == nil: nico no puede proponer
    expect((await proponer(f, { agente: 'nico' })).esError).toBe(true)
    // interno (unit test del port): lista de definiciones de herramientas MCP por agente (colegas, consultar, proponer_accion)
  })

  test('proponer_accion crea la entrega «Propuesta: ...» y la acción pendiente; una herramienta no asignada da error', async () => {
    const f = await fix()
    await asignar(f, [conectoresCalendar()])
    const r = await proponer(f)
    expect(r.esError, r.texto).toBe(false)
    const e = (await entregas(f))[0]!
    expect(str(e.origen)).toBe('propuesta')
    expect(str(e.titulo)).toBe('Propuesta: Crear la reunión del lunes')
    expect(str(e.estado)).toBe('sin_revisar')
    const completa = (await f.get(`/api/entregas/${e.id}`)).obj
    const texto = str(dict(completa.entrega).texto)
    expect(texto.includes('Crear la reunión del lunes') && texto.includes('create_event') && texto.includes('titulo: Reunión')).toBe(true)
    const a = await accionDe(f, e.id)
    expect(str(a.estado)).toBe('pendiente')
    expect(str(a.herramienta)).toBe(crearCal)
    expect(str(a.agente)).toBe('marce')
    expect(dict(a.detalle).fecha).toBe('2026-11-16')
    const todas = lista((await f.get('/api/acciones', { estado: 'pendiente' })).obj.acciones)
    expect(todas.length).toBe(1)
    // por id (la entrega «Acción aprobada» lleva ref «accion:<id>» y la busca así)
    expect(str(dict((await f.get('/api/acciones', { id: String(a.id) })).obj.accion).resumen)).toBe(str(a.resumen))
    expect((await f.get('/api/acciones', { id: '999' })).obj.accion).toBe(null)
    expect((await f.get('/api/acciones', { id: 'x' })).status).toBe(400)
    expect(lista((await f.get('/api/acciones', { estado: 'hecha' })).obj.acciones)).toEqual([])
    expect((await f.get('/api/acciones', { estado: 'rara' })).status).toBe(400)

    // no asignada para actuar (ni la de leer, ni una de otro servidor)
    for (const h of [enviarMail, leerCal, '']) {
      const m = await proponer(f, { herramienta: h })
      expect(m.esError, h).toBe(true)
    }
    expect((await proponer(f, { resumen: '  ' })).esError).toBe(true)
    expect((await proponer(f, { detalle: 'no es un objeto' })).esError).toBe(true)
    expect((await entregas(f)).length, 'los rechazos no dejan entregas').toBe(1)
  })

  test('proponer_accion: cupo de 5 por corrida', async () => {
    const f = await fix()
    await asignar(f, [conectoresCalendar()])
    // una sola corrida (un token) con 6 propuestas seguidas
    const rs = await proponerVarias(f, Array.from({ length: 6 }, (_, i) => ({ herramienta: crearCal, resumen: `Evento ${i + 1}`, detalle: { titulo: 'Reunión', fecha: '2026-11-16' } })))
    for (const r of rs.slice(0, 5)) expect(r.esError, r.texto).toBe(false)
    const sexta = rs[5]!
    expect(sexta.esError && sexta.texto.includes('5')).toBe(true)
    expect(lista((await f.get('/api/acciones')).obj.acciones).length).toBe(5)
    // otro token, otro cupo
    expect((await proponer(f, { resumen: 'Evento 7' })).esError).toBe(false)
  })

  test('ejecutar: la herramienta va en --allowedTools, la acción queda hecha con su resultado y la entrega revisada', async () => {
    const f = await fix()
    await asignar(f, [conectoresCalendar()])
    await proponer(f)
    const e = (await entregas(f))[0]!
    const id = e.id as number
    const r = await f.post(`/api/entregas/${id}/ejecutar`)
    expect(r.status, JSON.stringify(r.obj)).toBe(202)
    expect(typeof dict(r.obj.ejecucion).tarea).toBe('string')
    expect(await esperar(async () => str((await accionDe(f, id)).estado) === 'hecha', 15)).toBe(true)
    const a = await accionDe(f, id)
    expect(str(a.resultado).includes('hola marce') && typeof a.ejecucion === 'number').toBe(true)
    expect(str((await entregaDe(f, id)).estado)).toBe('revisada')

    const l = conPrompt(f, 'Crear la reunión del lunes').at(-1)!
    expect(Sandbox.reglas(l).includes(crearCal), 'la herramienta aprobada va en --allowedTools').toBe(true)
    expect(Sandbox.reglas(l).includes(leerCal)).toBe(true)
    const msg = l.at(-1)!
    expect(msg.includes('Crear la reunión del lunes') && msg.includes('2026-11-16')).toBe(true)
    // las reglas van como mensaje de sistema; en la charla queda solo la acción
    expect((Sandbox.valor(l, '--append-system-prompt') ?? '').normalize('NFC')).toContain('Ana aprobó la acción del mensaje. Ejecutá exactamente eso')
    expect(msg).not.toContain('Ejecutá exactamente')
    // el resultado queda en la propuesta: no hay una entrega aparte de origen «accion»
    const origenes = (await entregas(f)).map((x) => str(x.origen))
    expect(origenes).toEqual(['propuesta'])
    // ya no está pendiente
    expect((await f.post(`/api/entregas/${id}/ejecutar`)).status).toBe(409)
    expect((await f.post(`/api/entregas/${id}/descartar-accion`)).status).toBe(409)
  })

  test('ejecutar: sin acción da 404; con la herramienta ya desasignada da 409 y no cambia nada', async () => {
    const f = await fix()
    await asignar(f, [conectoresCalendar()])
    expect((await f.post('/api/entregas/999/ejecutar')).status).toBe(404)
    // interno (unit test del port): entrega «suelta» creada con store.entregaCrear (sin acción) -> ejecutar y descartar-accion dan 404
    await proponer(f)
    const e = (await entregas(f)).find((x) => str(x.origen) === 'propuesta')!
    const id = e.id as number
    await asignar(f, [conectoresCalendar(false)])
    const antes = f.sb.llamadas.length
    expect((await f.post(`/api/entregas/${id}/ejecutar`)).status).toBe(409)
    expect(str((await accionDe(f, id)).estado)).toBe('pendiente')
    expect(str((await entregaDe(f, id)).estado)).toBe('sin_revisar')
    expect(conPrompt(f, 'Acción aprobada (')).toEqual([])
    expect(f.sb.llamadas.length).toBe(antes)
    expect((await llamar(f.b, 'GET', `/api/entregas/${id}/ejecutar`)).status).toBe(405)
    // otras rutas de entregas siguen siendo del router de entregas
    expect((await f.post(`/api/entregas/${id}/revisada`)).status).toBe(200)
  })

  test('ejecutar: si la ejecución falla, la acción queda en error', async () => {
    const f = await fix()
    await asignar(f, [conectoresCalendar()])
    await proponer(f)
    const e = (await entregas(f))[0]!
    const id = e.id as number
    f.sb.modo('marce', 'error')
    expect((await f.post(`/api/entregas/${id}/ejecutar`)).status).toBe(202)
    expect(await esperar(async () => str((await accionDe(f, id)).estado) === 'error', 15)).toBe(true)
    expect(str((await accionDe(f, id)).resultado)).not.toBe('')
  })

  test('descartar-accion: deja la acción descartada y la entrega revisada, sin lanzar claude', async () => {
    const f = await fix()
    await asignar(f, [conectoresCalendar()])
    await proponer(f)
    const e = (await entregas(f))[0]!
    const id = e.id as number
    const antes = f.sb.llamadas.length   // (la propuesta salió de un chat del agente)
    const r = await f.post(`/api/entregas/${id}/descartar-accion`)
    expect(r.status).toBe(200)
    expect(str(dict(r.obj.accion).estado)).toBe('descartada')
    expect(str((await entregaDe(f, id)).estado)).toBe('revisada')
    expect(f.sb.llamadas.length).toBe(antes)
    expect((await f.post(`/api/entregas/${id}/ejecutar`)).status).toBe(409)
    expect(lista((await f.get('/api/acciones', { estado: 'descartada' })).obj.acciones).length).toBe(1)
    expect((await f.get('/api/acciones', { entrega: 'x' })).status).toBe(400)
    expect(dict((await f.get('/api/acciones', { entrega: '12345' })).obj).accion).toBeNull()
  })
})

// Preferencia de toda la app `conectores_agentes`: «todos» = cada agente usa todos los conectores conectados (leer libre,
// actuar por proponer_accion) sin asignarlos uno por uno; «por_agente» (o sin elegir) = la tabla de siempre.
describe('Todos los conectores para todos los agentes', () => {
  const vedadasDe = (l: string[]) => {
    const i = l.indexOf('--disallowedTools')
    if (i < 0) return []
    const resto = l.slice(i + 1)
    const fin = resto.findIndex((x) => x.startsWith('--'))
    return fin < 0 ? resto : resto.slice(0, fin)
  }

  test('preferencias: por defecto por_agente, valida y se guarda', async () => {
    const f = await fix()
    expect((await f.get('/api/preferencias')).obj.conectores_agentes).toBe('por_agente')
    expect((await llamar(f.b, 'GET', '/api/estado')).obj.conectores_agentes).toBe('por_agente')
    expect((await llamar(f.b, 'PUT', '/api/preferencias', { body: { conectores_agentes: 'algunos' } })).status).toBe(400)
    const r = await llamar(f.b, 'PUT', '/api/preferencias', { body: { conectores_agentes: 'todos' } })
    expect(r.status).toBe(200)
    expect(r.obj.conectores_agentes).toBe('todos')
    // cambiar solo esto no toca el modo de permisos
    expect(r.obj.modo_permisos).toBeNull()
    const cfg = JSON.parse(fs.readFileSync(path.join(f.sb.datos, 'config.json'), 'utf8'))
    expect(cfg.conectores_agentes).toBe('todos')
  })

  test('todos: un agente sin conectores asignados lee con todos, propone acciones y no tiene vedas', async () => {
    const sb = new Sandbox()
    claudeMezcla(sb)
    const f = await fix(undefined, sb)
    expect((await f.post('/api/conectores/actualizar')).obj.error).toBeUndefined()
    await llamar(f.b, 'PUT', '/api/preferencias', { body: { conectores_agentes: 'todos' } })
    await chat(f.b, { agent: 'marce', message: 'hola', session: U.a })
    const l = ultima(f)
    const todas = Sandbox.reglas(l)
    const corte = todas.findIndex((x) => x.startsWith('--'))
    const reglas = corte < 0 ? todas : todas.slice(0, corte)
    for (const h of [leerCal, verCal, leerMail]) expect(reglas.includes(h), h).toBe(true)
    expect(reglas.includes(crearCal) || reglas.includes(enviarMail)).toBe(false)
    expect(reglas.includes('mcp__hq__proponer_accion')).toBe(true)
    // lo de actuar no se ve directo: va por proponer_accion
    expect(new Set(vedadasDe(l))).toEqual(new Set([crearCal, enviarMail]))
    const instr = Sandbox.valor(l, '--append-system-prompt') ?? ''
    expect(instr.includes('Google Calendar') && instr.includes('Gmail') && instr.includes('proponer_accion')).toBe(true)
    // y puede proponer una acción de un conector que nunca se le asignó
    expect((await proponer(f, { herramienta: enviarMail, detalle: { para: 'x@y.z' } })).esError).toBe(false)
  })

  test('por_agente otra vez: vuelve la veda de todos los conectores', async () => {
    const sb = new Sandbox()
    claudeMezcla(sb)
    const f = await fix(undefined, sb)
    expect((await f.post('/api/conectores/actualizar')).obj.error).toBeUndefined()
    await llamar(f.b, 'PUT', '/api/preferencias', { body: { conectores_agentes: 'todos' } })
    await llamar(f.b, 'PUT', '/api/preferencias', { body: { conectores_agentes: 'por_agente' } })
    await chat(f.b, { agent: 'marce', message: 'hola', session: U.a })
    expect(vedadasDe(ultima(f))).toEqual(['mcp__claude_ai_*'])
  })
})
