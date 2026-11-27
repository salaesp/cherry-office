// Secretaría (docs/plan-secretaria.md, fase S2): configuración, cuándo revisa, cursor confirmado, reporte sin novedades,
// «Revisar ahora» y qué chats de WhatsApp ve quien la atiende. WhatsApp va con una captura doble (sin red).
import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'vitest'
import { mcpDe } from '../../src/consultas.js'
import type { Oficina } from '../../src/oficina.js'
import { HerramientasMCPAgente } from '../../src/permisos.js'
import { ServicioSecretaria, decodificarSecretaria, enFranja, esVacia, secretariaDe } from '../../src/secretaria.js'
import { whatsappDe, type ProcesoCaptura } from '../../src/whatsapp.js'
import type { ACaptura, DeCaptura } from '../../src/whatsapp-mapeo.js'
import { Sandbox, U, esperar } from '../support/sandbox.js'
import { arrancar, llamar, oficina } from '../support/en-proceso.js'

const MAMA = '5491155551234@s.whatsapp.net'
const GRUPO = '120363000000000000@g.us'

class CapturaDoble extends EventEmitter implements ProcesoCaptura {
  send(_m: ACaptura) { return true }
  kill() { this.emit('exit', 1); return true }
  emitir(m: DeCaptura) { this.emit('message', m) }
}

async function preparar() {
  const sb = new Sandbox()
  const b = arrancar(sb)
  const carpeta = await oficina(b, ['marce', 'sofia'])
  const capturas: CapturaDoble[] = []
  b.servicios.huecos.whatsappHost = { lanzar: () => { const c = new CapturaDoble(); capturas.push(c); return c } }
  await llamar(b, 'POST', '/api/whatsapp/vincular', { aceptoRiesgo: true })
  const c = capturas[0]!
  c.emitir({ tipo: 'estado', estado: 'conectado', numero: '5491100000001@s.whatsapp.net' })
  c.emitir({ tipo: 'chats', chats: [{ jid: MAMA, grupo: false, agenda: 'Mamá' }, { jid: GRUPO, grupo: true, agenda: 'Familia' }] })
  await llamar(b, 'PUT', '/api/whatsapp/chats/' + encodeURIComponent(MAMA), { elegido: true, nota: 'tiene turnos médicos' })
  await llamar(b, 'PUT', '/api/whatsapp/chats/' + encodeURIComponent(GRUPO), { elegido: true })
  const wa = whatsappDe(b.servicios)!
  const sec = secretariaDe(b.servicios)!
  let n = 0
  const mensaje = (texto: string, ts: number, chat = MAMA, propio = false) =>
    c.emitir({ tipo: 'mensaje', m: { id: 'm' + ++n, chat, de: propio ? 'yo' : chat === GRUPO ? '5491177777777@s.whatsapp.net' : chat, propio, ts, tipo: 'texto', texto } })
  const ultimaConsigna = () => { const ls = sb.llamadas; const a = ls[ls.length - 1] ?? []; return a[a.length - 1] ?? '' }
  return { sb, b, carpeta, wa, sec, mensaje, ultimaConsigna }
}

const ahora = () => Math.floor(Date.now() / 1000)
const enSeg = (seg: number) => new Date(Date.now() + seg * 1000)
const configurar = (b: any, extra: Record<string, unknown> = {}) =>
  llamar(b, 'PUT', '/api/secretaria', { agente: 'sofia', fuentes: [{ id: 'whatsapp', cada: { valor: 1, unidad: 'horas' }, chats: [MAMA] }], ...extra })

describe('configuración', () => {
  const o: Oficina = { version: 1, nombre: 'O', duenio: 'Ana', departamentos: [], agentes: [{ id: 'sofia', nombre: 'Sofía', rol: 'r', departamento: 'd' }] }
  const base = { agente: 'sofia', fuentes: [{ id: 'whatsapp', cada: { valor: 30, unidad: 'minutos' }, chats: [MAMA] }] }

  test('valida agente, fuentes, intervalo y franja', () => {
    expect(decodificarSecretaria(base, o, ['whatsapp'])).toEqual({ agente: 'sofia', activa: true, reporteVacio: false, fuentes: [{ id: 'whatsapp', cada: { valor: 30, unidad: 'minutos' }, chats: [MAMA] }] })
    expect(() => decodificarSecretaria({ ...base, agente: 'nadie' }, o, ['whatsapp'])).toThrow(/agente/)
    expect(() => decodificarSecretaria({ ...base, fuentes: [{ id: 'fax', cada: { valor: 1, unidad: 'horas' } }] }, o, ['whatsapp'])).toThrow(/desconocida/)
    expect(() => decodificarSecretaria({ ...base, fuentes: [base.fuentes[0], base.fuentes[0]] }, o, ['whatsapp'])).toThrow(/repetida/)
    for (const cada of [{ valor: 4, unidad: 'minutos' }, { valor: 25, unidad: 'horas' }, { valor: 1.5, unidad: 'horas' }, { valor: 1, unidad: 'dias' }]) {
      expect(() => decodificarSecretaria({ ...base, fuentes: [{ id: 'whatsapp', cada }] }, o, ['whatsapp'])).toThrow(/5 minutos y 24 horas/)
    }
    expect(decodificarSecretaria({ ...base, franja: { desde: '08:00', hasta: '22:00' } }, o, ['whatsapp']).franja).toEqual({ desde: '08:00', hasta: '22:00' })
    expect(() => decodificarSecretaria({ ...base, franja: { desde: '8', hasta: '22:00' } }, o, ['whatsapp'])).toThrow(/HH:MM/)
  })

  test('franja horaria, también cruzando la medianoche', () => {
    const a = (h: number, m = 0) => new Date(2026, 10, 26, h, m)
    expect(enFranja(undefined, a(3))).toBe(true)
    expect(enFranja({ desde: '08:00', hasta: '22:00' }, a(8))).toBe(true)
    expect(enFranja({ desde: '08:00', hasta: '22:00' }, a(22))).toBe(false)
    expect(enFranja({ desde: '08:00', hasta: '22:00' }, a(7, 59))).toBe(false)
    expect(enFranja({ desde: '22:00', hasta: '07:00' }, a(23))).toBe(true)
    expect(enFranja({ desde: '22:00', hasta: '07:00' }, a(6))).toBe(true)
    expect(enFranja({ desde: '22:00', hasta: '07:00' }, a(12))).toBe(false)
  })

  test('«Sin novedades» se reconoce con o sin adornos', () => {
    for (const t of ['Sin novedades.', '  sin novedades', '**Sin novedades**', '«Sin novedades»']) expect(esVacia(t)).toBe(true)
    expect(esVacia('Hay un turno nuevo. Sin novedades en lo demás.')).toBe(false)
  })
})

describe('secretaría', () => {
  test('PUT y GET; quien la atiende ve solo los chats de su fuente', async () => {
    const { b, carpeta } = await preparar()
    expect((await llamar(b, 'GET', '/api/secretaria')).obj.config).toBeNull()
    expect((await llamar(b, 'PUT', '/api/secretaria', { agente: 'nadie', fuentes: [] })).status).toBe(400)
    const r = await configurar(b)
    expect(r.status).toBe(200)
    expect(r.obj.config).toMatchObject({ agente: 'sofia', activa: true, fuentes: [{ id: 'whatsapp', chats: [MAMA] }] })
    expect(r.obj.agente).toMatchObject({ id: 'sofia', nombre: 'Sofia' })
    expect(r.obj.fuentes[0]).toMatchObject({ id: 'whatsapp', activa: true, disponible: true, problema: null, novedades: false })
    expect(r.obj.chatsWhatsApp.map((c: any) => c.nombre).sort()).toEqual(['Familia', 'Mamá'])

    // franja y cambio parcial (sin mandar todo de nuevo)
    expect((await llamar(b, 'PUT', '/api/secretaria', { franja: { desde: '08:00', hasta: '22:00' } })).obj.config.franja).toEqual({ desde: '08:00', hasta: '22:00' })
    expect((await llamar(b, 'PUT', '/api/secretaria', { franja: null })).obj.config.franja).toBeUndefined()

    const o = b.servicios.oficinas.activa()!.oficina
    const sofia = o.agentes.find((a) => a.id === 'sofia')!
    const marce = o.agentes.find((a) => a.id === 'marce')!
    expect(HerramientasMCPAgente.lista(o, sofia)).toContain('mcp__hq__whatsapp_leer')
    expect(HerramientasMCPAgente.lista(o, marce)).not.toContain('mcp__hq__whatsapp_leer')
    const mcp = mcpDe(b.servicios)!
    const id = { oficina: carpeta, agente: 'sofia', sid: U.a, perfil: 'agente' }
    const t = mcp.consultas.herramientas(mcp.tokens.emitir(id), id)
    const chats = (await t.llamar('whatsapp_chats', {}))!.texto
    expect(chats).toContain('Mamá')
    expect(chats).not.toContain('Familia')
    expect((await t.llamar('whatsapp_leer', { chat: 'Familia' }))!.esError).toBe(true)

    // «todos»: revisa todos los chats que se leen (para un negocio con «leer todos los chats individuales»)
    const rt = await llamar(b, 'PUT', '/api/secretaria', { fuentes: [{ id: 'whatsapp', cada: { valor: 30, unidad: 'minutos' }, chats: [MAMA], todos: true }] })
    expect(rt.obj.config.fuentes[0]).toMatchObject({ todos: true })
    expect(rt.obj.whatsappLeerTodos).toBe(false)
    expect(rt.obj.fuentes[0].problema).toBeNull()
    const t2 = mcp.consultas.herramientas(mcp.tokens.emitir(id), id)
    expect((await t2.llamar('whatsapp_chats', {}))!.texto).toContain('Familia')
    await llamar(b, 'PUT', '/api/secretaria', { fuentes: [{ id: 'whatsapp', cada: { valor: 30, unidad: 'minutos' }, chats: [MAMA] }] })

    // sacarla
    expect((await llamar(b, 'PUT', '/api/secretaria', { agente: null })).obj.config).toBeNull()
    expect(HerramientasMCPAgente.lista(b.servicios.oficinas.activa()!.oficina, sofia)).not.toContain('mcp__hq__whatsapp_leer')
  })

  test('revisa lo nuevo, avanza el cursor al terminar bien y la próxima trae lo anterior como contexto', async () => {
    const { b, carpeta, sec, mensaje, ultimaConsigna } = await preparar()
    await configurar(b)
    expect(await sec.revisar()).toBeUndefined()   // sin mensajes, no gasta
    mensaje('El jueves a las 10 tengo turno con el cardiólogo', ahora() - 300)
    mensaje('asado el domingo', ahora() - 300, GRUPO)   // el grupo no es de esta fuente
    const r = await sec.revisar()
    expect(r).toMatchObject({ estado: 'corriendo', fuentes: ['whatsapp'], manual: false })
    await esperar(() => sec.store.una(r!.id)?.estado !== 'corriendo')
    expect(sec.store.una(r!.id)).toMatchObject({ estado: 'ok', vacia: false })
    const c1 = ultimaConsigna()
    expect(c1).toContain('atendés la secretaría de Ana')
    expect(c1).toContain('<mensajes_whatsapp chat="Mamá">')
    expect(c1).toContain('Nota de Ana sobre este chat: tiene turnos médicos')
    expect(c1).toContain('Nuevo:')
    expect(c1).toContain('turno con el cardiólogo')
    expect(c1).not.toContain('asado')
    expect(c1).not.toContain('Ya revisado (solo como contexto')
    expect(sec.store.cursor(carpeta, 'whatsapp')[MAMA]).toBeGreaterThan(0)
    const e = b.servicios.entregas.una(carpeta, sec.store.una(r!.id)!.entrega!)
    expect(e).toMatchObject({ origen: 'secretaria', estado: 'sin_revisar' })

    // enseguida no le toca; una hora después sin nada nuevo, tampoco
    mensaje('¿Me acompañás?', ahora() - 200)
    expect(await sec.revisar()).toBeUndefined()
    // lo propio no es novedad
    expect(await sec.revisar(enSeg(3601))).toBeDefined()
    await esperar(() => !sec.store.corriendo(carpeta))
    const c2 = ultimaConsigna()
    expect(c2).toContain('Ya revisado (solo como contexto')
    expect(c2.indexOf('turno con el cardiólogo')).toBeLessThan(c2.indexOf('Nuevo:'))
    expect(c2.slice(c2.indexOf('Nuevo:'))).toContain('¿Me acompañás?')
    mensaje('dale', ahora() - 100, MAMA, true)
    expect(await sec.revisar(enSeg(7300))).toBeUndefined()
  })

  test('espera a que la conversación se calme', async () => {
    const { b, carpeta, sec, mensaje } = await preparar()
    await configurar(b)
    mensaje('hola', ahora() - 10)
    expect(await sec.revisar()).toBeUndefined()
    expect(await sec.revisar(enSeg(ServicioSecretaria.quietud + 5))).toBeDefined()
    await esperar(() => !sec.store.corriendo(carpeta))
  })

  test('si la corrida falla, el cursor no avanza y la próxima vuelve a tomar esos mensajes', async () => {
    const { b, carpeta, sec, mensaje, ultimaConsigna } = await preparar()
    await configurar(b)
    mensaje('turno el martes ISERR', ahora() - 300)
    const r = await sec.revisar()
    await esperar(() => sec.store.una(r!.id)?.estado !== 'corriendo')
    expect(sec.store.una(r!.id)?.estado).toBe('fallida')
    expect(sec.store.cursor(carpeta, 'whatsapp')[MAMA]).toBeUndefined()
    const r2 = await sec.revisar(enSeg(3601))
    expect(r2).toBeDefined()
    expect(ultimaConsigna()).toContain('turno el martes')
    await esperar(() => !sec.store.corriendo(carpeta))
  })

  test('sin novedades: entrega silenciosa y ya revisada (salvo que se pida verla)', async () => {
    const { b, carpeta, sec, mensaje } = await preparar()
    await configurar(b)
    mensaje('jaja FAKE_SIN_NOVEDADES', ahora() - 300)
    const r = await sec.revisar()
    await esperar(() => sec.store.una(r!.id)?.estado !== 'corriendo')
    await esperar(() => sec.store.una(r!.id)?.entrega !== undefined)
    const rev = sec.store.una(r!.id)!
    expect(rev).toMatchObject({ estado: 'ok', vacia: true })
    await esperar(() => b.servicios.entregas.una(carpeta, rev.entrega!)?.estado === 'revisada')
    expect(b.servicios.entregas.una(carpeta, rev.entrega!)?.estado).toBe('revisada')

    await configurar(b, { reporteVacio: true })
    mensaje('otra vez FAKE_SIN_NOVEDADES', ahora() - 300)
    const r2 = await sec.revisar(enSeg(3601))
    await esperar(() => sec.store.una(r2!.id)?.entrega !== undefined)
    expect(b.servicios.entregas.una(carpeta, sec.store.una(r2!.id)!.entrega!)?.estado).toBe('sin_revisar')
  })

  test('«Revisar ahora», franja horaria, pausa y revisiones que quedaron a medias', async () => {
    const { b, carpeta, sec, mensaje } = await preparar()
    expect((await llamar(b, 'POST', '/api/secretaria/revisar')).status).toBe(409)
    await configurar(b)
    expect((await llamar(b, 'POST', '/api/secretaria/revisar')).obj).toEqual({ revision: null, motivo: 'No hay nada nuevo desde la última revisión.' })
    mensaje('turno DORMIR', ahora() - 5)   // reciente: «Revisar ahora» no espera la calma
    const r = await llamar(b, 'POST', '/api/secretaria/revisar')
    expect(r.obj.revision).toMatchObject({ estado: 'corriendo', manual: true })
    expect((await llamar(b, 'POST', '/api/secretaria/revisar')).status).toBe(409)
    expect((await llamar(b, 'GET', '/api/secretaria')).obj.corriendo).toBe(true)
    await esperar(() => !sec.store.corriendo(carpeta))
    expect((await llamar(b, 'GET', '/api/secretaria')).obj.revisiones[0]).toMatchObject({ estado: 'ok', manual: true })

    // fuera de la franja no revisa sola
    const h = new Date().getHours()
    const fuera = { desde: `${String((h + 2) % 24).padStart(2, '0')}:00`, hasta: `${String((h + 3) % 24).padStart(2, '0')}:00` }
    await configurar(b, { franja: fuera })
    mensaje('algo nuevo', ahora() - 300)
    expect(await sec.revisar(enSeg(3601))).toBeUndefined()
    await configurar(b, { franja: null, activa: false })
    expect(await sec.revisar(enSeg(3601))).toBeUndefined()

    // una revisión que quedó corriendo de antes (la app se cerró) queda incierta y no avanzó el cursor
    const vieja = sec.store.crear({ oficina: carpeta, fuentes: ['whatsapp'], hasta: { whatsapp: { [MAMA]: ahora() } }, manual: false, parcial: false })
    sec.iniciar()
    expect(sec.store.una(vieja.id)?.estado).toBe('incierta')
  })

  test('exportar la oficina no lleva los chats de la secretaría', async () => {
    const { b, sb } = await preparar()
    await configurar(b)
    const r = await llamar(b, 'POST', '/api/oficina/exportar', { destino: sb.home })
    expect(r.status).toBe(200)
    const { unzipSync, strFromU8 } = await import('fflate')
    const fs = await import('node:fs')
    const zip = unzipSync(new Uint8Array(fs.readFileSync(r.obj.archivo)))
    const nombre = Object.keys(zip).find((k) => k.endsWith('oficina.json'))!
    const of = JSON.parse(strFromU8(zip[nombre]!))
    expect(of.secretaria.agente).toBe('sofia')
    expect(of.secretaria.fuentes[0].chats).toBeUndefined()
    expect(JSON.stringify(of)).not.toContain('5491155551234')
  })
})

describe('fuentes de conector (S3)', () => {
  const leerMail = 'mcp__claude_ai_Gmail__search_threads'
  const leerCal = 'mcp__claude_ai_Google_Calendar__list_events'
  const catalogo = [
    { nombre: 'Gmail', prefijo: 'mcp__claude_ai_Gmail', estado: 'connected', herramientas: [leerMail, 'mcp__claude_ai_Gmail__send_message'] },
    { nombre: 'Google Calendar', prefijo: 'mcp__claude_ai_Google_Calendar', estado: 'connected', herramientas: [leerCal, 'mcp__claude_ai_Google_Calendar__create_event'] },
  ]

  test('sin catálogo, sin conector o sin asignar: no se revisa y se explica por qué', async () => {
    const { b, sec } = await preparar()
    await configurar(b, { fuentes: [{ id: 'gmail', cada: { valor: 1, unidad: 'horas' } }] })
    let g = (await llamar(b, 'GET', '/api/secretaria')).obj.fuentes.find((f: any) => f.id === 'gmail')
    expect(g).toMatchObject({ tipo: 'conector', disponible: false, activa: true })
    expect(g.problema).toMatch(/Ajustes › Conectores/)
    const { catalogoDe } = await import('../../src/conectores.js')
    catalogoDe(b.servicios)!.fijar(catalogo)
    g = (await llamar(b, 'GET', '/api/secretaria')).obj.fuentes.find((f: any) => f.id === 'gmail')
    expect(g).toMatchObject({ disponible: true, novedades: null })
    expect(g.problema).toMatch(/no tiene Gmail asignado/)
    expect(await sec.revisar()).toBeUndefined()
  })

  test('Gmail y WhatsApp en la misma revisión; el cursor de Gmail avanza al terminar bien', async () => {
    const { b, carpeta, sec, mensaje, ultimaConsigna } = await preparar()
    const { catalogoDe } = await import('../../src/conectores.js')
    catalogoDe(b.servicios)!.fijar(catalogo)
    expect((await llamar(b, 'PATCH', '/api/agentes/sofia', { conectores: [{ servidor: 'Gmail', leer: [leerMail], actuar: [] }, { servidor: 'Google Calendar', leer: [leerCal], actuar: [] }] })).status).toBe(200)
    await configurar(b, { fuentes: [
      { id: 'whatsapp', cada: { valor: 1, unidad: 'horas' }, chats: [MAMA] },
      { id: 'gmail', cada: { valor: 4, unidad: 'horas' }, indicacion: 'solo mails del banco y del colegio' },
      { id: 'calendario', cada: { valor: 12, unidad: 'horas' } },
    ] })
    const g = (await llamar(b, 'GET', '/api/secretaria')).obj.fuentes.find((f: any) => f.id === 'gmail')
    expect(g).toMatchObject({ disponible: true, problema: null })
    // sin mensajes de WhatsApp igual revisa Gmail y el calendario (no se puede saber si hay algo sin preguntar)
    const r = await sec.revisar()
    expect(r?.fuentes).toEqual(['gmail', 'calendario'])
    await esperar(() => sec.store.una(r!.id)?.estado !== 'corriendo')
    const c = ultimaConsigna()
    expect(c).toContain('--- Fuente: Gmail ---')
    expect(c).toMatch(/after:\d{10}/)
    expect(c).toContain('Indicación de Ana para esta fuente: solo mails del banco y del colegio')
    expect(c).toContain('--- Fuente: Calendario ---')
    expect(c).toContain('próximas 48 horas')
    expect(c).not.toContain('--- Fuente: WhatsApp ---')
    const desde = sec.store.cursor(carpeta, 'gmail').desde!
    expect(Math.abs(desde - ahora())).toBeLessThan(10)

    // una hora después: le toca a WhatsApp (con un mensaje) pero no a Gmail ni al calendario
    mensaje('turno el viernes', ahora() - 300)
    const r2 = await sec.revisar(enSeg(3601))
    expect(r2?.fuentes).toEqual(['whatsapp'])
    await esperar(() => !sec.store.corriendo(carpeta))
    // cuatro horas después: Gmail retoma desde la revisión anterior
    const r3 = await sec.revisar(enSeg(4 * 3600 + 5))
    expect(r3?.fuentes).toEqual(['gmail'])
    await esperar(() => !sec.store.corriendo(carpeta))
    expect(ultimaConsigna()).toContain(`after:${desde}`)
  })
})

describe('notas de voz (S4)', () => {
  test('espera a que termine la transcripción (hasta el tope) y la manda en el material', async () => {
    const { b, carpeta, sec, wa, ultimaConsigna } = await preparar()
    const pedidos: any[] = []
    const tr = new EventEmitter() as any
    tr.send = (m: any) => { if (m.tipo === 'transcribir') pedidos.push(m); return true }
    tr.kill = () => true
    ;(b.servicios.huecos.whatsappHost as any).lanzarTranscriptor = () => tr
    await llamar(b, 'PUT', '/api/whatsapp/ajustes', { transcribir: true })
    await configurar(b)
    const c = (wa as any).proceso as EventEmitter
    c.emit('message', { tipo: 'mensaje', m: { id: 'v1', chat: MAMA, de: MAMA, propio: false, ts: ahora() - 600, tipo: 'nota_de_voz', segundos: 9, media: { archivo: 'a'.repeat(32) + '.bin', mime: 'audio/ogg', bytes: 10 } } })
    expect(pedidos.length).toBe(1)
    expect(await sec.revisar()).toBeUndefined()   // se está transcribiendo
    tr.emit('message', { tipo: 'texto', chat: MAMA, id: 'v1', texto: 'tengo turno el jueves a las diez' })
    const r = await sec.revisar()
    expect(r).toBeDefined()
    await esperar(() => !sec.store.corriendo(carpeta))
    expect(ultimaConsigna()).toContain('[nota de voz, 9 s] dice: «tengo turno el jueves a las diez»')

    // si la transcripción no llega, revisa igual pasado el tope
    c.emit('message', { tipo: 'mensaje', m: { id: 'v2', chat: MAMA, de: MAMA, propio: false, ts: ahora() - 600, tipo: 'nota_de_voz', segundos: 5, media: { archivo: 'b'.repeat(32) + '.bin', mime: 'audio/ogg', bytes: 10 } } })
    expect(await sec.revisar(enSeg(3601))).toBeUndefined()
    expect(await sec.revisar(enSeg(3601 + ServicioSecretaria.esperaMaxima))).toBeDefined()
    await esperar(() => !sec.store.corriendo(carpeta))
    expect(ultimaConsigna()).toContain('[nota de voz, 5 s] (transcribiendo…)')
  })
})

describe('contratar en un paso', () => {
  const leerMail = 'mcp__claude_ai_Gmail__search_threads'
  const leerCal = 'mcp__claude_ai_Google_Calendar__list_events'
  const crearCal = 'mcp__claude_ai_Google_Calendar__create_event'
  const catalogo = [
    { nombre: 'Gmail', prefijo: 'mcp__claude_ai_Gmail', estado: 'connected', herramientas: [leerMail, 'mcp__claude_ai_Gmail__send_message'] },
    { nombre: 'Google Calendar', prefijo: 'mcp__claude_ai_Google_Calendar', estado: 'connected', herramientas: [leerCal, crearCal] },
  ]

  test('queda en la recepción, con los chats elegidos, Gmail y el calendario asignados; no se contrata dos veces', async () => {
    const { b } = await preparar()
    const { catalogoDe } = await import('../../src/conectores.js')
    catalogoDe(b.servicios)!.fijar(catalogo)
    const r = await llamar(b, 'POST', '/api/secretaria/contratar', { nombre: 'Rosa' })
    expect(r.status).toBe(200)
    expect(r.obj.agente).toMatchObject({ id: 'rosa', nombre: 'Rosa' })
    expect(r.obj.config.fuentes.map((f: any) => f.id)).toEqual(['whatsapp', 'gmail', 'calendario'])
    expect(r.obj.config.fuentes[0].chats.sort()).toEqual([GRUPO, MAMA].sort())
    const o = b.servicios.oficinas.activa()!.oficina
    const rosa = o.agentes.find((a) => a.id === 'rosa')!
    expect(rosa).toMatchObject({ rol: 'Secretaría', departamento: 'recepcion' })
    expect(rosa.conectores).toEqual([
      { servidor: 'Gmail', leer: [leerMail], actuar: [] },
      { servidor: 'Google Calendar', leer: [leerCal], actuar: [crearCal] },
    ])
    expect(r.obj.fuentes.find((f: any) => f.id === 'gmail').problema).toBeNull()
    expect((await llamar(b, 'POST', '/api/secretaria/contratar', { nombre: 'Otra' })).status).toBe(409)
    // la recepción vale como departamento (se puede mover y volver)
    expect((await llamar(b, 'PATCH', '/api/agentes/rosa', { departamento: 'direccion' })).status).toBe(200)
    expect((await llamar(b, 'PATCH', '/api/agentes/rosa', { departamento: 'recepcion' })).status).toBe(200)
    expect((await llamar(b, 'PATCH', '/api/agentes/rosa', { departamento: 'nada' })).status).toBe(400)
  })

  test('elegir un chat desde la secretaría lo elige en WhatsApp; prender Gmail le asigna el conector', async () => {
    const { b, wa } = await preparar()
    const otro = '5491188888888@s.whatsapp.net'
    ;(wa as any).proceso.emit('message', { tipo: 'chats', chats: [{ jid: otro, grupo: false, agenda: 'Papá' }] })
    const r = await llamar(b, 'POST', '/api/secretaria/contratar', {})
    expect(r.obj.agente.nombre).toBe('Secretaría')
    expect(r.obj.config.fuentes.map((f: any) => f.id)).toEqual(['whatsapp'])
    expect(r.obj.chatsWhatsApp.find((c: any) => c.jid === otro)).toMatchObject({ nombre: 'Papá', elegido: false })
    const id = r.obj.agente.id
    const p = await llamar(b, 'PUT', '/api/secretaria', { fuentes: [{ id: 'whatsapp', cada: { valor: 1, unidad: 'horas' }, chats: [MAMA, otro] }] })
    expect(p.status).toBe(200)
    expect(wa.store.chat(otro)).toMatchObject({ elegido: true, nombre: 'Papá' })
    const { catalogoDe } = await import('../../src/conectores.js')
    catalogoDe(b.servicios)!.fijar(catalogo)
    await llamar(b, 'PUT', '/api/secretaria', { fuentes: [...p.obj.config.fuentes, { id: 'gmail', cada: { valor: 4, unidad: 'horas' } }] })
    const ag = b.servicios.oficinas.activa()!.oficina.agentes.find((a) => a.id === id)!
    expect(ag.conectores).toEqual([{ servidor: 'Gmail', leer: [leerMail], actuar: [] }])
  })
})
