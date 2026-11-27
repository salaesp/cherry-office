// Pasar trabajo y preguntar desde la charla (delegar.ts) y el audio de la persona (audio.ts): las herramientas solo mientras
// corre un mensaje de la persona (y `delegar` para el coordinador sin la persona), la ventana para deshacer, las propuestas,
// lo programado, las tarjetas de una charla, lo que espera a la persona y la transcripción. Sin red: el claude falso responde
// y, cuando el mensaje lleva MCP_LLAMAR, hace las llamadas que se le dejan.
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { accionesDe } from '../../src/acciones.js'
import { audioDe, leerWav } from '../../src/audio.js'
import { mcpDe } from '../../src/consultas.js'
import { Delegaciones, delegacionesDe, herramientasDelegar, instruccionesCharla, leerCuando } from '../../src/delegar.js'
import { motorDe } from '../../src/flujos.js'
import { OficinaStore, type Oficina } from '../../src/oficina.js'
import { Sandbox, esperar } from '../support/sandbox.js'
import { arrancar, llamar, oficina } from '../support/en-proceso.js'

const ventanaOriginal = Delegaciones.ventana
afterEach(() => { Delegaciones.ventana = ventanaOriginal })

const consigna = 'Armá el presupuesto para Prospera con 3 licencias y soporte por 12 meses; entregá un PDF con el total y las condiciones.'
const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'

/** WAV PCM 16 bits mono de `segundos` (un tono). */
function wav(segundos: number, frecuencia = 16000): Buffer {
  const n = Math.round(segundos * frecuencia)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(frecuencia, 24); b.writeUInt32LE(frecuencia * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii'); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), 44 + i * 2)
  return b
}

async function preparar() {
  const sb = new Sandbox()
  const b = arrancar(sb)
  const carpeta = await oficina(b, ['marce', 'nico', { id: 'coordi', permisos: ['coordinador'] }])
  const d = delegacionesDe(b.servicios)!
  /** Un mensaje de la persona a `agente` en la charla `session`. */
  const chat = (message: string, { agent = 'marce', session = S1 } = {}) => llamar(b, 'POST', '/api/chat', { agent, session, message })
  const tarjetas = async (session = S1) => (await llamar(b, 'GET', '/api/charlas/tarjetas', undefined, { session })).obj
  const decidir = (id: number, accion: string, opcion?: number) => llamar(b, 'POST', `/api/charlas/tarjetas/${id}`, { accion, ...(opcion !== undefined ? { opcion } : {}) })
  /** El prompt que recibió nico (el encargo), si hubo. */
  const encargoDeNico = () => sb.llamadas.find((a) => a.includes('nico') && (a[a.length - 1] ?? '').includes(consigna))
  return { sb, b, carpeta, d, chat, tarjetas, decidir, encargoDeNico }
}

describe('lógica pura', () => {
  test('leerCuando: fecha futura AAAA-MM-DDTHH:MM', () => {
    const ahora = new Date(2026, 10, 27, 10, 0)
    expect(leerCuando('2026-11-28T09:00', ahora)).toEqual({ fecha: '2026-11-28', hora: '09:00' })
    expect(leerCuando('2026-11-28 18:30', ahora)).toEqual({ fecha: '2026-11-28', hora: '18:30' })
    expect(leerCuando('2026-11-26T09:00', ahora)).toBeUndefined()
    expect(leerCuando('2026-02-30T09:00', ahora)).toBeUndefined()
    expect(leerCuando('mañana', ahora)).toBeUndefined()
  })

  test('instruccionesCharla: quién escribe, cuándo delegar o preguntar y el equipo (sin el propio agente)', () => {
    const o: Oficina = { version: 1, nombre: 'O', duenio: 'Ana', departamentos: [], agentes: [
      { id: 'marce', nombre: 'Marce', rol: 'Ventas', departamento: 'd' }, { id: 'nico', nombre: 'Nico', rol: 'Diseño', departamento: 'd' }] }
    const t = instruccionesCharla(o, o.agentes[0]!)
    expect(t).toContain('## Pasar trabajo y preguntar')
    expect(t).toContain('te escribe Ana')
    expect(t).toContain('explicito: true solo si Ana pidió')
    expect(t).toContain('- Nico (id nico): Diseño')
    expect(t).not.toContain('(id marce)')
    expect(instruccionesCharla({ ...o, agentes: [o.agentes[0]!] }, o.agentes[0]!)).toContain('no podés pasarle trabajo a nadie')
  })

  test('leerWav: duración de un WAV PCM 16 bits; otra cosa no pasa', () => {
    expect(leerWav(wav(2))?.segundos).toBeCloseTo(2, 2)
    expect(leerWav(wav(1, 48000))).toMatchObject({ frecuencia: 48000, canales: 1 })
    expect(leerWav(Buffer.from('OggS no es un wav'))).toBeUndefined()
    const ochoBits = wav(1); ochoBits.writeUInt16LE(8, 34)
    expect(leerWav(ochoBits)).toBeUndefined()
  })
})

describe('delegar desde la charla', () => {
  test('las instrucciones van como mensaje de sistema en la charla', async () => {
    const { sb, chat } = await preparar()
    expect((await chat('hola')).status).toBe(200)
    const l = sb.llamadas.at(-1)!
    const sis = l[l.indexOf('--append-system-prompt') + 1]!
    expect(sis).toContain('## Pasar trabajo y preguntar')
    expect(sis).toContain('- Nico (id nico)')
    expect(l.at(-1)).toBe('hola')
  })

  test('pedido explícito: espera la ventana, corre como encargo de nico y la tarjeta queda hecha con su entrega, debajo de la respuesta', async () => {
    Delegaciones.ventana = 0
    const { sb, chat, tarjetas, encargoDeNico, b, carpeta } = await preparar()
    sb.llamadasMCP('marce', [{ name: 'delegar', arguments: { agente: 'Nico', nombre: 'Presupuesto Prospera', consigna, explicito: true } }])
    const r = await chat('MCP_LLAMAR decile a Nico que arme el presupuesto')
    expect(r.status).toBe(200)
    const out = sb.salidasMCP('marce')[0] as any
    expect(JSON.parse(out.result.content[0].text)).toMatchObject({ ok: true, agente: 'nico', estado: 'esperando' })
    expect(await esperar(async () => (await tarjetas()).tarjetas[0]?.estado === 'hecha', 20)).toBe(true)
    const t = (await tarjetas()).tarjetas[0]
    // turno 1: debajo de la primera respuesta (mensaje 0 de la persona, 1 de marce)
    expect(t).toMatchObject({ tipo: 'delegacion', agente: 'marce', session: S1, turno: 1, para: 'nico', nombre: 'Presupuesto Prospera', consigna })
    expect(t.entrega).toBeGreaterThan(0)
    expect(b.servicios.entregas.lista(carpeta, { origen: 'encargo' })[0]?.agente).toBe('nico')
    const p = encargoDeNico()!.at(-1)!
    expect(p).toContain('Encargo que Ana le pidió a Marce (Rol de marce) en una charla, para vos')
  })

  test('dentro de la ventana se puede deshacer y nunca corre; «ya» lo lanza sin esperar', async () => {
    Delegaciones.ventana = 300
    const { sb, chat, tarjetas, decidir, encargoDeNico } = await preparar()
    sb.llamadasMCP('marce', [{ name: 'delegar', arguments: { agente: 'nico', nombre: 'Presupuesto', consigna, explicito: true } }])
    await chat('MCP_LLAMAR decile a Nico')
    const t = (await tarjetas()).tarjetas[0]
    expect(t.estado).toBe('esperando')
    expect((await decidir(t.id, 'cancelar')).status).toBe(200)
    expect((await tarjetas()).tarjetas[0].estado).toBe('cancelada')
    expect((await decidir(t.id, 'cancelar')).status).toBe(409)
    expect(encargoDeNico()).toBeUndefined()
    sb.llamadasMCP('marce', [{ name: 'delegar', arguments: { agente: 'nico', nombre: 'Presupuesto', consigna, explicito: true } }])
    await chat('MCP_LLAMAR otra vez')
    const t2 = (await tarjetas()).tarjetas[1]
    expect(t2.turno).toBe(3)
    expect((await decidir(t2.id, 'ya')).status).toBe(200)
    expect(await esperar(async () => (await tarjetas()).tarjetas[1].estado === 'hecha', 20)).toBe(true)
  })

  test('deducido: queda como propuesta (y en lo que te espera) hasta que se confirma o se descarta', async () => {
    Delegaciones.ventana = 0
    const { sb, b, chat, tarjetas, decidir, encargoDeNico } = await preparar()
    sb.llamadasMCP('marce', [{ name: 'delegar', arguments: { agente: 'nico', nombre: 'Presupuesto', consigna, explicito: false } }])
    await chat('MCP_LLAMAR habría que ver lo del presupuesto')
    const t = (await tarjetas()).tarjetas[0]
    expect(t.estado).toBe('propuesta')
    expect((await llamar(b, 'GET', '/api/charlas/pendientes')).obj.tarjetas.map((x: any) => x.id)).toEqual([t.id])
    expect((await llamar(b, 'GET', '/api/actividad')).obj.teEsperan).toBe(1)
    await new Promise((x) => setTimeout(x, 200))
    expect(encargoDeNico()).toBeUndefined()
    expect((await decidir(t.id, 'confirmar')).status).toBe(200)
    expect(await esperar(async () => (await tarjetas()).tarjetas[0].estado === 'hecha', 20)).toBe(true)
    expect((await decidir(t.id, 'confirmar')).status).toBe(409)
    expect((await llamar(b, 'GET', '/api/actividad')).obj.teEsperan).toBe(0)
  })

  test('para más adelante: queda como tarea única en oficina.json; cancelar la saca', async () => {
    const { sb, chat, tarjetas, decidir, carpeta } = await preparar()
    const manana = new Date(Date.now() + 86400_000)
    const dia = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, '0')}-${String(manana.getDate()).padStart(2, '0')}`
    sb.llamadasMCP('marce', [{ name: 'delegar', arguments: { agente: 'nico', nombre: 'Presupuesto', consigna, explicito: true, cuando: `${dia}T09:00` } }])
    await chat('MCP_LLAMAR que Nico lo haga mañana a las 9')
    expect(await esperar(async () => (await tarjetas()).tarjetas[0]?.estado === 'programada', 5)).toBe(true)
    const t = (await tarjetas()).tarjetas[0]
    const tarea = OficinaStore.leer(carpeta).tareas!.find((x) => x.id === t.tarea)!
    expect(tarea).toMatchObject({ agente: 'nico', nombre: 'Presupuesto', fecha: dia, hora: '09:00', activa: true })
    expect(tarea.consigna).toContain(consigna)
    expect((await decidir(t.id, 'cancelar')).status).toBe(200)
    expect(OficinaStore.leer(carpeta).tareas!.some((x) => x.id === t.tarea)).toBe(false)
  })

  test('errores: a sí mismo, alguien que no está, consigna corta, sin «explicito», fecha mala, más de 3', async () => {
    Delegaciones.ventana = 300
    const { sb, chat, tarjetas } = await preparar()
    const d = (args: Record<string, unknown>) => ({ name: 'delegar', arguments: { agente: 'nico', nombre: 'X', consigna, explicito: true, ...args } })
    sb.llamadasMCP('marce', [d({ agente: 'marce' }), d({ agente: 'nadie' }), d({ consigna: 'hacelo' }), d({ explicito: undefined }), d({ cuando: 'mañana' }), d({}), d({}), d({}), d({})])
    await chat('MCP_LLAMAR muchas cosas')
    const s = sb.salidasMCP('marce') as any[]
    const textos = s.map((x) => x.result.content[0].text as string)
    expect(s.slice(0, 5).every((x) => x.result.isError)).toBe(true)
    expect(textos[0]).toContain('No podés delegarte a vos')
    expect(textos[1]).toContain('No hay nadie «nadie»')
    expect(textos[2]).toContain('muy corta')
    expect(textos[3]).toContain('explicito')
    expect(textos[4]).toContain('cuando')
    expect(s.slice(5, 8).every((x) => !x.result.isError)).toBe(true)
    expect(textos[8]).toContain('Ya delegaste 3')
    expect((await tarjetas()).tarjetas).toHaveLength(3)
  })
})

describe('preguntar', () => {
  test('la pregunta queda abierta (y en lo que te espera); responder devuelve el mensaje para la charla, que la cierra', async () => {
    const { sb, b, chat, tarjetas, decidir } = await preparar()
    sb.llamadasMCP('marce', [{ name: 'preguntar', arguments: { texto: '¿Presupuesto formal o mail?', opciones: [{ texto: 'Presupuesto formal', detalle: 'Nico lo arma' }, { texto: 'Un mail' }, { texto: '' }] } }])
    await chat('MCP_LLAMAR mandale los precios a Prospera')
    const t = (await tarjetas()).tarjetas[0]
    expect(t).toMatchObject({ tipo: 'pregunta', estado: 'abierta', texto: '¿Presupuesto formal o mail?', opciones: [{ texto: 'Presupuesto formal', detalle: 'Nico lo arma' }, { texto: 'Un mail' }] })
    expect((await llamar(b, 'GET', '/api/charlas/pendientes')).obj.tarjetas).toHaveLength(1)
    expect((await llamar(b, 'GET', '/api/actividad')).obj.teEsperan).toBe(1)
    expect((await decidir(t.id, 'responder', 7)).status).toBe(400)
    const r = await decidir(t.id, 'responder', 1)
    expect(r.status).toBe(200)
    expect(r.obj.mensaje).toEqual({ agente: 'marce', session: S1, texto: 'Elijo: Un mail' })
    expect(r.obj.tarjeta).toMatchObject({ estado: 'abierta', elegida: 1 })
    // la interfaz manda ese mensaje en la charla: la pregunta queda respondida
    await chat('Elijo: Un mail')
    expect((await tarjetas()).tarjetas[0]).toMatchObject({ estado: 'respondida', elegida: 1 })
    expect((await llamar(b, 'GET', '/api/actividad')).obj.teEsperan).toBe(0)
    expect((await decidir(t.id, 'responder', 0)).status).toBe(409)
  })

  test('una sola pregunta por mensaje; un mensaje en otra charla no la cierra', async () => {
    const { sb, chat, tarjetas } = await preparar()
    sb.llamadasMCP('marce', [{ name: 'preguntar', arguments: { texto: 'a' } }, { name: 'preguntar', arguments: { texto: 'b' } }])
    await chat('MCP_LLAMAR algo')
    expect((sb.salidasMCP('marce') as any[])[1].result.isError).toBe(true)
    expect((await tarjetas()).tarjetas).toHaveLength(1)
    await chat('otra cosa', { session: S2 })
    expect((await tarjetas()).tarjetas[0].estado).toBe('abierta')
  })
})

describe('cuándo existen las herramientas', () => {
  test('solo mientras corre un mensaje de la persona en esa charla; el coordinador sin la persona solo delega', async () => {
    const { b, carpeta, d } = await preparar()
    const s = b.servicios
    const id = (agente: string, perfil = 'agente', interactivo = false) => ({ oficina: carpeta, agente, sid: S1, perfil, interactivo })
    expect(herramientasDelegar(s, 't', id('marce'))).toBeUndefined()
    expect(herramientasDelegar(s, 't', id('marce', 'agente', true))).toBeUndefined()   // una reunión: interactivo, pero no es su charla
    expect(herramientasDelegar(s, 't', id('coordi', 'coordinador'))?.definiciones.map((x) => x.name)).toEqual(['delegar'])
    expect(herramientasDelegar(s, 't', id('coordi', 'coordinador', true))).toBeUndefined()
    d.empezarCharla(carpeta, 'marce', S1)
    expect(herramientasDelegar(s, 't', id('marce', 'agente', true))?.definiciones.map((x) => x.name)).toEqual(['delegar', 'arrancar_flujo', 'preguntar'])
    expect(herramientasDelegar(s, 't', { ...id('marce', 'agente', true), sid: S2 })).toBeUndefined()
    expect(herramientasDelegar(s, 't', id('nico', 'agente', true))).toBeUndefined()
    d.terminarCharla(carpeta, 'marce', S1)
    expect(herramientasDelegar(s, 't', id('marce', 'agente', true))).toBeUndefined()
  })

  test('una tarea programada de un agente común no tiene delegar', async () => {
    const { b, carpeta } = await preparar()
    const mcp = mcpDe(b.servicios)!
    const ident = { oficina: carpeta, agente: 'marce', sid: S1, perfil: 'agente' }
    const h = mcp.consultas.herramientas(mcp.tokens.emitir(ident), ident)
    expect(h.definiciones.map((x) => x.name)).not.toContain('delegar')
    expect(await h.llamar('delegar', { agente: 'nico', nombre: 'X', consigna })).toBeUndefined()
  })
})

describe('tarjetas de una charla', () => {
  test('las propuestas de acción de la charla van con el índice de la respuesta debajo de la que van', async () => {
    const { b, carpeta, chat, tarjetas } = await preparar()
    await chat('primero')
    const ac = accionesDe(b.servicios)!.crear({ oficina: carpeta, agente: 'marce', sid: S1, herramienta: 'mcp__x__create_event', resumen: 'Crear el evento', detalle: '{}', entrega: 1 })!
    await chat('segundo')
    const r = await tarjetas()
    expect(r.acciones.map((a: any) => [a.id, a.turno])).toEqual([[ac.id, 2]])
    expect((await llamar(b, 'GET', '/api/charlas/tarjetas', undefined, { session: 'x' })).status).toBe(400)
    expect((await llamar(b, 'POST', '/api/charlas/tarjetas/999', { accion: 'cancelar' })).status).toBe(404)
  })
})

describe('audio', () => {
  test('transcribe un WAV con el transcriptor y borra el archivo temporal', async () => {
    const { b } = await preparar()
    const a = audioDe(b.servicios)!
    const vistos: string[] = []
    a.transcribir = async (archivo) => { vistos.push(archivo); expect(fs.existsSync(archivo)).toBe(true); return '  decile a Nico   que revise el contrato ' }
    const r = await llamar(b, 'POST', '/api/audio/transcribir', { wav: wav(1.5).toString('base64') })
    expect(r.status).toBe(200)
    expect(r.obj.texto).toBe('decile a Nico que revise el contrato')
    expect(path.basename(path.dirname(vistos[0]!))).toBe('audio-tmp')
    expect(fs.existsSync(vistos[0]!)).toBe(false)
  })

  test('rechazos: no es WAV, muy corto, sin transcriptor, falla, no se entendió nada', async () => {
    const { b } = await preparar()
    const a = audioDe(b.servicios)!
    const post = (w: Buffer) => llamar(b, 'POST', '/api/audio/transcribir', { wav: w.toString('base64') })
    a.transcribir = async () => 'hola'
    expect((await post(Buffer.from('nada'))).status).toBe(400)
    expect((await post(wav(0.1))).status).toBe(400)
    expect((await llamar(b, 'POST', '/api/audio/transcribir', {})).status).toBe(400)
    expect((await llamar(b, 'GET', '/api/audio/transcribir')).status).toBe(405)
    a.transcribir = undefined
    expect((await post(wav(1))).status).toBe(503)
    a.transcribir = async () => { throw new Error('sin motor') }
    const f = await post(wav(1))
    expect(f.status).toBe(503)
    expect(f.obj.error).toContain('sin motor')
    a.transcribir = async () => '   '
    expect((await post(wav(1))).status).toBe(422)
  })
})

describe('arrancar un flujo desde la charla', () => {
  /** Un flujo «Alta de cliente» que arranca con un paso de la persona (así la corrida no lanza a ningún agente). */
  async function conFlujo(activo = true) {
    const x = await preparar()
    const f = await llamar(x.b, 'POST', '/api/flujos', { nombre: 'Alta de cliente', descripcion: 'Incorporar un cliente nuevo', activo, pasos: [
      { nombre: 'Firmar el contrato', quien: 'persona', entrega: 'Contrato firmado' },
      { nombre: 'Bienvenida', quien: 'nico', entrega: 'Mail de bienvenida' },
    ] })
    expect(f.status, JSON.stringify(f.obj)).toBe(200)
    return { ...x, flujo: String(f.obj.flujo.id) }
  }
  const contexto = 'Cliente: Prospera. Contacto: Laura Gómez (laura@prospera.com). Arrancan en enero con 3 licencias.'

  test('pedido explícito: espera la ventana y arranca la corrida con su contexto', async () => {
    Delegaciones.ventana = 0
    const { sb, b, carpeta, chat, tarjetas, flujo } = await conFlujo()
    sb.llamadasMCP('marce', [{ name: 'arrancar_flujo', arguments: { flujo: 'Alta de cliente', nombre: 'Alta Prospera', contexto, explicito: true } }])
    await chat('MCP_LLAMAR arrancá el alta de cliente para Prospera')
    const out = JSON.parse((sb.salidasMCP('marce')[0] as any).result.content[0].text)
    expect(out).toMatchObject({ ok: true, flujo, estado: 'esperando' })
    expect(await esperar(async () => (await tarjetas()).tarjetas[0]?.estado === 'arrancado', 20)).toBe(true)
    const t = (await tarjetas()).tarjetas[0]
    expect(t).toMatchObject({ tipo: 'flujo', agente: 'marce', turno: 1, flujo, flujoNombre: 'Alta de cliente', nombre: 'Alta Prospera', contexto })
    const c = motorDe(b.servicios)!.store.corrida(carpeta, t.corrida)!
    expect(c).toMatchObject({ flujo, nombre: 'Alta Prospera' })
    expect(c.contexto).toContain('Laura Gómez')
  })

  test('deducido: queda como propuesta (y en lo que te espera) hasta que se confirma; descartar la cierra', async () => {
    Delegaciones.ventana = 0
    const { sb, b, chat, tarjetas, decidir } = await conFlujo()
    sb.llamadasMCP('marce', [
      { name: 'arrancar_flujo', arguments: { flujo: 'alta-de-cliente', nombre: 'Alta Prospera', contexto, explicito: false } },
      { name: 'arrancar_flujo', arguments: { flujo: 'alta-de-cliente', nombre: 'Alta Norte', contexto, explicito: false } },
    ])
    await chat('MCP_LLAMAR sumamos a Prospera y a Norte como clientes')
    const [t1, t2] = (await tarjetas()).tarjetas
    expect([t1.estado, t2.estado]).toEqual(['propuesta', 'propuesta'])
    expect((await llamar(b, 'GET', '/api/charlas/pendientes')).obj.tarjetas).toHaveLength(2)
    expect((await llamar(b, 'GET', '/api/actividad')).obj.teEsperan).toBe(2)
    expect((await decidir(t1.id, 'confirmar')).status).toBe(200)
    expect((await tarjetas()).tarjetas[0].estado).toBe('arrancado')
    expect((await decidir(t2.id, 'descartar')).status).toBe(200)
    expect((await tarjetas()).tarjetas[1].estado).toBe('cancelada')
    expect((await decidir(t1.id, 'cancelar')).status).toBe(409)
    expect((await llamar(b, 'GET', '/api/actividad')).obj.teEsperan).toBe(0)
  })

  test('dentro de la ventana se puede deshacer y la corrida nunca arranca', async () => {
    Delegaciones.ventana = 300
    const { sb, b, carpeta, chat, tarjetas, decidir } = await conFlujo()
    sb.llamadasMCP('marce', [{ name: 'arrancar_flujo', arguments: { flujo: 'Alta de cliente', nombre: 'Alta Prospera', contexto, explicito: true } }])
    await chat('MCP_LLAMAR arrancá el alta de cliente')
    const t = (await tarjetas()).tarjetas[0]
    expect(t.estado).toBe('esperando')
    expect((await decidir(t.id, 'cancelar')).status).toBe(200)
    expect((await tarjetas()).tarjetas[0].estado).toBe('cancelada')
    expect(motorDe(b.servicios)!.store.corridas(carpeta)).toHaveLength(0)
  })

  test('errores: flujo que no está, pausado, sin «explicito» y más de 2 por mensaje', async () => {
    Delegaciones.ventana = 300
    const { sb, chat, tarjetas, b } = await conFlujo()
    await llamar(b, 'POST', '/api/flujos', { nombre: 'Cierre de mes', activo: false, pasos: [{ nombre: 'Cerrar', quien: 'persona', entrega: 'Cierre' }] })
    const f = (args: Record<string, unknown>) => ({ name: 'arrancar_flujo', arguments: { flujo: 'Alta de cliente', nombre: 'X', contexto, explicito: true, ...args } })
    sb.llamadasMCP('marce', [f({ flujo: 'nada' }), f({ flujo: 'Cierre de mes' }), f({ explicito: undefined }), f({}), f({}), f({})])
    await chat('MCP_LLAMAR muchos flujos')
    const textos = (sb.salidasMCP('marce') as any[]).map((x) => [x.result.isError ?? false, x.result.content[0].text as string])
    expect(textos[0]).toEqual([true, expect.stringContaining('No hay un flujo «nada»')])
    expect(textos[1]).toEqual([true, expect.stringContaining('pausado')])
    expect(textos[2]).toEqual([true, expect.stringContaining('explicito')])
    expect(textos[3]![0]).toBe(false)
    expect(textos[4]![0]).toBe(false)
    expect(textos[5]).toEqual([true, expect.stringContaining('Ya arrancaste 2')])
    expect((await tarjetas()).tarjetas).toHaveLength(2)
  })

  test('las instrucciones listan los flujos activos con su primer paso; sin flujos no hablan de arrancar_flujo', async () => {
    const o: Oficina = { version: 1, nombre: 'O', duenio: 'Ana', departamentos: [], agentes: [
      { id: 'marce', nombre: 'Marce', rol: 'Ventas', departamento: 'd' }, { id: 'nico', nombre: 'Nico', rol: 'Diseño', departamento: 'd' }] }
    expect(instruccionesCharla(o, o.agentes[0]!)).not.toContain('arrancar_flujo')
    const conFlujos: Oficina = { ...o, flujos: [
      { id: 'alta', nombre: 'Alta de cliente', descripcion: 'Cliente nuevo', activo: true, pasos: [{ id: 'p1', nombre: 'Cargar datos', quien: 'nico', entrega: 'Ficha', aprobacion: false }] },
      { id: 'cierre', nombre: 'Cierre', activo: false, pasos: [{ id: 'p1', nombre: 'Cerrar', quien: 'persona', entrega: 'x', aprobacion: false }] },
    ] }
    const t = instruccionesCharla(conFlujos, conFlujos.agentes[0]!)
    expect(t).toContain('arrancar_flujo')
    expect(t).toContain('- Alta de cliente (id alta): Cliente nuevo · arranca con «Cargar datos» (Nico)')
    expect(t).not.toContain('(id cierre)')
  })
})
