// Recados a la secretaría (recados.ts, docs/plan-recados.md): recibir texto o audio, la cola de a uno, la corrida en el hilo
// de la secretaría, las herramientas `delegar` y `preguntar` (solo mientras corre un recado y en su hilo), la ventana para
// deshacer, las propuestas, lo programado, el estado visible y las rutas. Sin red: el claude falso responde y, cuando el
// recado lleva MCP_LLAMAR, hace las llamadas que se le dejan.
import fs from 'node:fs'
import { afterEach, describe, expect, test } from 'vitest'
import { OficinaStore } from '../../src/oficina.js'
import {
  LimitesRecados, Recados, estadoRecado, herramientasRecados, leerCuando, leerWav, partirRespuesta, recadosDe,
  type Recado, type ResultadoRecado,
} from '../../src/recados.js'
import { Sandbox, esperar } from '../support/sandbox.js'
import { arrancar, llamar, oficina } from '../support/en-proceso.js'

const ventanaOriginal = Recados.ventana
afterEach(() => { Recados.ventana = ventanaOriginal })

const consigna = 'Armá el presupuesto para Prospera con 3 licencias y soporte por 12 meses; entregá un PDF con el total y las condiciones.'

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

async function preparar({ secretaria = true }: { secretaria?: boolean } = {}) {
  const sb = new Sandbox()
  const b = arrancar(sb)
  const carpeta = await oficina(b, ['marce', 'sofia'])
  if (secretaria) expect((await llamar(b, 'PUT', '/api/secretaria', { agente: 'sofia', fuentes: [{ id: 'whatsapp', cada: { valor: 1, unidad: 'horas' }, chats: [] }] })).status).toBe(200)
  const rec = recadosDe(b.servicios)!
  const mandar = (texto: string, extra: Record<string, unknown> = {}) => llamar(b, 'POST', '/api/recados', { texto, ...extra })
  const uno = async (id: number) => (await llamar(b, 'GET', `/api/recados/${id}`)).obj.recado
  /** Espera a que el recado deje de procesarse y lo devuelve. */
  const listo = async (id: number, segundos = 20) => {
    const ok = await esperar(async () => ['listo', 'fallido'].includes((await uno(id)).fase), segundos)
    expect(ok, 'el recado termina').toBe(true)
    return uno(id)
  }
  /** Las corridas de recados: las instrucciones van como mensaje de sistema y el mensaje es solo lo que dijo la persona. */
  const corridas = () => sb.llamadas.map((a) => ({ i: a.indexOf('--append-system-prompt'), a }))
    .filter(({ i, a }) => i >= 0 && (a[i + 1] ?? '').includes('# Recados'))
    .map(({ i, a }) => ({ sistema: a[i + 1]!, mensaje: a[a.length - 1]! }))
  const prompts = () => corridas().map((c) => c.mensaje)
  return { sb, b, carpeta, rec, mandar, uno, listo, prompts, corridas }
}

describe('lógica pura', () => {
  test('partirRespuesta separa «Entendí:» del resto', () => {
    expect(partirRespuesta('Entendí: que Marce arme el presupuesto.\nLe pasé el trabajo.\nTe agendé el viernes.')).toEqual({
      entendi: 'que Marce arme el presupuesto.', respuesta: 'Le pasé el trabajo.\nTe agendé el viernes.',
    })
    expect(partirRespuesta('**Entendí:** algo')).toEqual({ entendi: 'algo', respuesta: '' })
    expect(partirRespuesta('Nada nuevo de mamá.')).toEqual({ respuesta: 'Nada nuevo de mamá.' })
  })

  test('leerWav: duración de un WAV PCM 16 bits; otra cosa no pasa', () => {
    expect(leerWav(wav(2))?.segundos).toBeCloseTo(2, 2)
    expect(leerWav(wav(1, 48000))).toMatchObject({ frecuencia: 48000, canales: 1 })
    expect(leerWav(Buffer.from('OggS no es un wav'))).toBeUndefined()
    const ochoBits = wav(1); ochoBits.writeUInt16LE(8, 34)
    expect(leerWav(ochoBits)).toBeUndefined()
  })

  test('leerCuando: fecha futura AAAA-MM-DDTHH:MM', () => {
    const ahora = new Date(2026, 10, 27, 10, 0)
    expect(leerCuando('2026-11-28T09:00', ahora)).toEqual({ fecha: '2026-11-28', hora: '09:00' })
    expect(leerCuando('2026-11-28 18:30', ahora)).toEqual({ fecha: '2026-11-28', hora: '18:30' })
    expect(leerCuando('2026-11-26T09:00', ahora)).toBeUndefined()
    expect(leerCuando('2026-02-30T09:00', ahora)).toBeUndefined()
    expect(leerCuando('mañana', ahora)).toBeUndefined()
  })

  test('estadoRecado: la fase mientras se procesa y después lo que dicen sus resultados', () => {
    const r = { fase: 'listo' } as Recado
    const res = (tipo: string, estado: string) => ({ tipo, estado }) as ResultadoRecado
    expect(estadoRecado({ fase: 'entendiendo' } as Recado, [], [])).toBe('entendiendo')
    expect(estadoRecado(r, [], [])).toBe('respondido')
    expect(estadoRecado(r, [res('delegacion', 'corriendo')], [])).toBe('delegado')
    expect(estadoRecado(r, [res('delegacion', 'hecha')], [])).toBe('hecho')
    expect(estadoRecado(r, [res('delegacion', 'cancelada')], [])).toBe('respondido')
    expect(estadoRecado(r, [res('delegacion', 'propuesta')], [])).toBe('esperando_ok')
    expect(estadoRecado(r, [res('delegacion', 'hecha')], [{ estado: 'pendiente' } as never])).toBe('esperando_ok')
    expect(estadoRecado(r, [res('pregunta', 'abierta'), res('delegacion', 'corriendo')], [])).toBe('esperando_respuesta')
  })
})

describe('recibir y procesar', () => {
  test('sin secretaría: 409; sin texto ni audio: 400', async () => {
    const { mandar } = await preparar({ secretaria: false })
    expect((await mandar('hola')).status).toBe(409)
    const p = await preparar()
    expect((await p.mandar('   ')).status).toBe(400)
    expect((await p.mandar('x'.repeat(LimitesRecados.maxTexto + 1))).status).toBe(400)
  })

  test('un recado de texto corre en el hilo de la secretaría: el mensaje es solo el recado y las instrucciones van como sistema', async () => {
    const { b, mandar, listo, prompts, corridas, sb, carpeta } = await preparar()
    const r = await mandar('¿Qué tengo mañana?')
    expect(r.status).toBe(200)
    expect(r.obj.recado).toMatchObject({ canal: 'app', texto: '¿Qué tengo mañana?' })
    const fin = await listo(r.obj.recado.id)
    expect(fin).toMatchObject({ fase: 'listo', estado: 'respondido', respuesta: 'hola sofia' })
    const p = prompts()
    expect(p).toHaveLength(1)
    expect(p[0]).toBe('¿Qué tengo mañana?')
    const sis = corridas()[0]!.sistema
    expect(sis).toContain('Marce (id marce)')
    expect(sis).toContain('Entendí:')
    // las reglas de siempre del agente siguen ahí, antes de las de los recados
    expect(sis).toMatch(/## Atendés la secretaría[\s\S]*# Recados/)
    // corre como sofia, en su sesión del hilo; el siguiente recado retoma la misma
    expect(sb.llamadas.at(-1)).toContain('sofia')
    const hilo = recadosDe(b.servicios)!.store.hilo(carpeta)!
    expect(hilo.agente).toBe('sofia')
    await listo((await mandar('Otra cosa')).obj.recado.id)
    expect(recadosDe(b.servicios)!.store.hilo(carpeta)!.sid).toBe(hilo.sid)
    expect(b.servicios.store.mensajes(hilo.sid).map((m) => m.t)).toEqual(['¿Qué tengo mañana?', 'hola sofia', 'Otra cosa', 'hola sofia'])
  })

  test('los recados van de a uno, en orden', async () => {
    const { b, mandar, listo, prompts, sb } = await preparar()
    sb.modo('sofia', 'lento')
    const a = (await mandar('primero')).obj.recado.id
    const c = (await mandar('segundo')).obj.recado.id
    await esperar(() => prompts().length === 1, 10)
    expect((await llamar(b, 'GET', '/api/recados')).obj.recados.map((x: any) => x.fase)).toEqual(['en_cola', 'entendiendo'])
    sb.modo('sofia', null)
    // el lento no termina solo: se corta matando su hijo
    try { process.kill(sb.childPid!) } catch {}
    await listo(a, 30)
    await listo(c, 30)
    const p = prompts()
    expect(p[0]).toContain('primero')
    expect(p[1]).toContain('segundo')
  }, 60_000)

  test('audio: se transcribe y la transcripción va al recado', async () => {
    const { b, mandar, listo, prompts, rec } = await preparar()
    const archivos: string[] = []
    rec.transcribir = async (archivo) => { archivos.push(archivo); return 'decile a Marce que revise el contrato' }
    const r = await llamar(b, 'POST', '/api/recados', { audio: { wav: wav(1.5).toString('base64') } })
    expect(r.status).toBe(200)
    expect(r.obj.recado).toMatchObject({ audio: true, fase: 'transcribiendo' })
    const fin = await listo(r.obj.recado.id)
    expect(fin.transcripcion).toBe('decile a Marce que revise el contrato')
    expect(prompts()[0]).toContain('(nota de voz, transcripta) decile a Marce que revise el contrato')
    expect(fs.existsSync(archivos[0]!)).toBe(true)
    // se puede volver a escuchar
    const a = await llamar(b, 'GET', `/api/recados/${fin.id}/audio`)
    expect(Buffer.from(a.obj.wav, 'base64').equals(wav(1.5))).toBe(true)
    // un audio que no es WAV o muy largo no entra
    expect((await mandar('', { audio: { wav: Buffer.from('nada').toString('base64') } })).status).toBe(400)
  })

  test('audio que no se puede transcribir: el recado falla con el motivo', async () => {
    const { b, listo, rec } = await preparar()
    rec.transcribir = async () => { throw new Error('sin motor') }
    const r = await llamar(b, 'POST', '/api/recados', { audio: { wav: wav(1).toString('base64') } })
    const fin = await listo(r.obj.recado.id)
    expect(fin).toMatchObject({ fase: 'fallido', estado: 'fallido' })
    expect(fin.error).toContain('sin motor')
  })
})

describe('delegar', () => {
  test('pedido explícito: se lanza después de la ventana y queda hecha con su entrega', async () => {
    Recados.ventana = 0
    const { sb, mandar, listo, uno } = await preparar()
    sb.llamadasMCP('sofia', [{ name: 'delegar', arguments: { agente: 'Marce', nombre: 'Presupuesto Prospera', consigna, explicito: true } }])
    const r = await mandar('MCP_LLAMAR decile a Marce que arme el presupuesto')
    await listo(r.obj.recado.id)
    const out = sb.salidasMCP('sofia')[0] as any
    expect(JSON.parse(out.result.content[0].text)).toMatchObject({ ok: true, agente: 'marce', estado: 'esperando' })
    const ok = await esperar(async () => (await uno(r.obj.recado.id)).resultados[0]?.estado === 'hecha', 20)
    expect(ok).toBe(true)
    const fin = await uno(r.obj.recado.id)
    expect(fin.estado).toBe('hecho')
    expect(fin.resultados[0]).toMatchObject({ tipo: 'delegacion', agente: 'marce', nombre: 'Presupuesto Prospera', consigna })
    expect(fin.resultados[0].entrega).toBeGreaterThan(0)
    // marce recibió la consigna, con quién se la pasa
    const p = sb.prompts.find((x) => x.includes(consigna))!
    expect(p).toContain('Ana le dejó a Sofia (secretaría) en un recado')
  })

  test('dentro de la ventana se puede cancelar y nunca corre', async () => {
    Recados.ventana = 30
    const { sb, b, mandar, listo, uno } = await preparar()
    sb.llamadasMCP('sofia', [{ name: 'delegar', arguments: { agente: 'marce', nombre: 'Presupuesto', consigna, explicito: true } }])
    const id = (await mandar('MCP_LLAMAR decile a Marce')).obj.recado.id
    const r = await listo(id)
    expect(r.estado).toBe('delegado')
    const d = r.resultados[0]
    expect((await llamar(b, 'POST', `/api/recados/${id}/resultados/${d.id}`, { accion: 'cancelar' })).status).toBe(200)
    expect((await uno(id)).resultados[0].estado).toBe('cancelada')
    expect((await uno(id)).estado).toBe('respondido')
    expect((await llamar(b, 'POST', `/api/recados/${id}/resultados/${d.id}`, { accion: 'cancelar' })).status).toBe(409)
    expect(sb.prompts.some((x) => x.includes(consigna))).toBe(false)
  })

  test('«ya» lo lanza sin esperar la ventana', async () => {
    Recados.ventana = 300
    const { sb, b, mandar, listo, uno } = await preparar()
    sb.llamadasMCP('sofia', [{ name: 'delegar', arguments: { agente: 'marce', nombre: 'Presupuesto', consigna, explicito: true } }])
    const id = (await mandar('MCP_LLAMAR decile a Marce')).obj.recado.id
    const d = (await listo(id)).resultados[0]
    expect((await llamar(b, 'POST', `/api/recados/${id}/resultados/${d.id}`, { accion: 'ya' })).status).toBe(200)
    expect(await esperar(async () => (await uno(id)).resultados[0].estado === 'hecha', 20)).toBe(true)
  })

  test('deducido: queda como propuesta hasta que se confirma (o se descarta)', async () => {
    Recados.ventana = 0
    const { sb, b, mandar, listo, uno } = await preparar()
    sb.llamadasMCP('sofia', [
      { name: 'delegar', arguments: { agente: 'marce', nombre: 'Presupuesto', consigna, explicito: false } },
    ])
    const id = (await mandar('MCP_LLAMAR habría que ver lo del presupuesto')).obj.recado.id
    const r = await listo(id)
    expect(r.estado).toBe('esperando_ok')
    expect(r.resultados[0].estado).toBe('propuesta')
    await new Promise((x) => setTimeout(x, 300))
    expect(sb.prompts.some((x) => x.includes(consigna))).toBe(false)
    expect((await llamar(b, 'POST', `/api/recados/${id}/resultados/${r.resultados[0].id}`, { accion: 'confirmar' })).status).toBe(200)
    expect(await esperar(async () => (await uno(id)).resultados[0].estado === 'hecha', 20)).toBe(true)
    expect((await llamar(b, 'POST', `/api/recados/${id}/resultados/${r.resultados[0].id}`, { accion: 'confirmar' })).status).toBe(409)
  })

  test('para más adelante: queda como tarea única en oficina.json; cancelar la saca', async () => {
    const { sb, b, carpeta, mandar, listo, uno } = await preparar()
    const manana = new Date(Date.now() + 86400_000)
    const dia = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, '0')}-${String(manana.getDate()).padStart(2, '0')}`
    sb.llamadasMCP('sofia', [{ name: 'delegar', arguments: { agente: 'marce', nombre: 'Presupuesto', consigna, explicito: true, cuando: `${dia}T09:00` } }])
    const id = (await mandar('MCP_LLAMAR que Marce lo haga mañana a las 9')).obj.recado.id
    await listo(id)
    expect(await esperar(async () => (await uno(id)).resultados[0]?.estado === 'programada', 5)).toBe(true)
    const r = await uno(id)
    const t = OficinaStore.leer(carpeta).tareas!.find((x) => x.id === r.resultados[0].tarea)!
    expect(t).toMatchObject({ agente: 'marce', nombre: 'Presupuesto', fecha: dia, hora: '09:00', activa: true })
    expect(t.consigna).toContain(consigna)
    expect((await llamar(b, 'POST', `/api/recados/${id}/resultados/${r.resultados[0].id}`, { accion: 'cancelar' })).status).toBe(200)
    expect(OficinaStore.leer(carpeta).tareas!.some((x) => x.id === r.resultados[0].tarea)).toBe(false)
  })

  test('errores: a sí misma, alguien que no está, consigna corta, sin «explicito», más de 3', async () => {
    Recados.ventana = 300
    const { sb, mandar, listo } = await preparar()
    const d = (args: Record<string, unknown>) => ({ name: 'delegar', arguments: { agente: 'marce', nombre: 'X', consigna, explicito: true, ...args } })
    sb.llamadasMCP('sofia', [d({ agente: 'sofia' }), d({ agente: 'nadie' }), d({ consigna: 'hacelo' }), d({ explicito: undefined }), d({ cuando: 'mañana' }), d({}), d({}), d({}), d({})])
    const r = await listo((await mandar('MCP_LLAMAR muchas cosas')).obj.recado.id)
    const salidas = sb.salidasMCP('sofia') as any[]
    const textos = salidas.map((x) => x.result.content[0].text as string)
    expect(salidas.slice(0, 5).every((x) => x.result.isError)).toBe(true)
    expect(textos[0]).toContain('No podés delegarte a vos')
    expect(textos[1]).toContain('No hay nadie «nadie»')
    expect(textos[2]).toContain('muy corta')
    expect(textos[3]).toContain('explicito')
    expect(textos[4]).toContain('cuando')
    expect(salidas.slice(5, 8).every((x) => !x.result.isError)).toBe(true)
    expect(salidas[8].result.isError).toBe(true)
    expect(textos[8]).toContain('Ya delegaste 3')
    expect(r.resultados).toHaveLength(3)
  })
})

describe('preguntar', () => {
  test('la pregunta deja el recado esperando; elegir una opción manda un recado nuevo que la contesta', async () => {
    const { sb, b, mandar, listo, uno, prompts, corridas } = await preparar()
    sb.llamadasMCP('sofia', [{ name: 'preguntar', arguments: { texto: '¿Presupuesto formal o mail?', opciones: [{ texto: 'Arrancar el presupuesto', detalle: 'Marce lo arma' }, { texto: 'Un mail' }, { texto: '' }] } }])
    const id = (await mandar('MCP_LLAMAR mandale los precios a Prospera')).obj.recado.id
    const r = await listo(id)
    expect(r.estado).toBe('esperando_respuesta')
    expect(r.resultados[0]).toMatchObject({ tipo: 'pregunta', estado: 'abierta', texto: '¿Presupuesto formal o mail?', opciones: [{ texto: 'Arrancar el presupuesto', detalle: 'Marce lo arma' }, { texto: 'Un mail' }] })
    expect((await llamar(b, 'POST', `/api/recados/${id}/resultados/${r.resultados[0].id}`, { accion: 'responder', opcion: 7 })).status).toBe(400)
    expect((await llamar(b, 'POST', `/api/recados/${id}/resultados/${r.resultados[0].id}`, { accion: 'responder', opcion: 1 })).status).toBe(200)
    const lista = (await llamar(b, 'GET', '/api/recados')).obj.recados
    const nuevo = lista[0]
    expect(nuevo.texto).toBe('Elijo: Un mail')
    await listo(nuevo.id)
    expect((await uno(id)).resultados[0].estado).toBe('respondida')
    expect((await uno(id)).estado).toBe('respondido')
    expect(prompts().at(-1)).toBe('Elijo: Un mail')
    expect(corridas().at(-1)!.sistema).toContain('Le habías preguntado: «¿Presupuesto formal o mail?»')
  })

  test('una sola pregunta por recado', async () => {
    const { sb, mandar, listo } = await preparar()
    sb.llamadasMCP('sofia', [{ name: 'preguntar', arguments: { texto: 'a' } }, { name: 'preguntar', arguments: { texto: 'b' } }])
    const r = await listo((await mandar('MCP_LLAMAR algo')).obj.recado.id)
    const s = sb.salidasMCP('sofia') as any[]
    expect(s[1].result.isError).toBe(true)
    expect(r.resultados).toHaveLength(1)
  })
})

describe('las herramientas existen solo en el hilo y mientras corre un recado', () => {
  test('fuera de un recado, en otra sesión o para otro agente no aparecen', async () => {
    const { b, carpeta, mandar, listo, rec } = await preparar()
    await listo((await mandar('hola')).obj.recado.id)
    const sid = rec.store.hilo(carpeta)!.sid
    const s = b.servicios
    expect(herramientasRecados(s, 't', { oficina: carpeta, agente: 'sofia', sid, perfil: 'agente' })).toBeUndefined()
    // simulando un recado en curso
    ;(rec as any).enCurso.set(sid, 1)
    expect(herramientasRecados(s, 't', { oficina: carpeta, agente: 'sofia', sid, perfil: 'agente' })?.definiciones.map((d) => d.name)).toEqual(['delegar', 'preguntar'])
    expect(herramientasRecados(s, 't', { oficina: carpeta, agente: 'marce', sid, perfil: 'agente' })).toBeUndefined()
    ;(rec as any).enCurso.set('otra', 1)
    expect(herramientasRecados(s, 't', { oficina: carpeta, agente: 'sofia', sid: 'otra', perfil: 'agente' })).toBeUndefined()
  })

  test('las revisiones de la secretaría no ven delegar ni preguntar', async () => {
    const { sb, b, mandar, listo } = await preparar()
    await listo((await mandar('hola')).obj.recado.id)
    // la lista de herramientas del token de una charla común de sofia (otra sesión) no las tiene
    sb.llamadasMCP('sofia', [{ name: 'delegar', arguments: { agente: 'marce', nombre: 'X', consigna, explicito: true } }])
    const r = await llamar(b, 'POST', '/api/chat', { agent: 'sofia', session: '11111111-1111-4111-8111-111111111111', message: 'MCP_LLAMAR hola' })
    expect(r.status).toBe(200)
    const out = sb.salidasMCP('sofia')[0] as any
    expect(out.result?.isError ?? !!out.error).toBe(true)
  })
})

describe('rutas', () => {
  test('GET /api/recados trae la secretaría, los recados (el último primero) y los topes', async () => {
    const { b, mandar, listo } = await preparar()
    await listo((await mandar('uno')).obj.recado.id)
    await listo((await mandar('dos')).obj.recado.id)
    const r = await llamar(b, 'GET', '/api/recados')
    expect(r.obj.secretaria).toEqual({ id: 'sofia', nombre: 'Sofia' })
    expect(r.obj.recados.map((x: any) => x.texto)).toEqual(['dos', 'uno'])
    expect(r.obj.maxSegundosAudio).toBe(LimitesRecados.maxSegundosAudio)
    expect((await llamar(b, 'GET', '/api/recados/999')).status).toBe(404)
    expect((await llamar(b, 'POST', '/api/recados', { texto: 'x', canal: 'telegram' })).status).toBe(400)
  })
})
