// Unit tests de Gobierno sin servidor HTTP: reescriben los tests `interno` de GobiernoTests.swift (Instrucciones.para,
// Conectores.parsearInit/clasificar, ConectoresAgente.herramientas, herramientas MCP de acciones, entrega sin acción).
import { describe, expect, test } from 'vitest'
import { Acciones, accionesDe } from '../../src/acciones.js'
import { CatalogoConectores, Conectores, catalogoDe } from '../../src/conectores.js'
import { mcpDe } from '../../src/consultas.js'
import type { AgenteDef, ConectorAsignado, Oficina } from '../../src/oficina.js'
import { ConectoresAgente, HerramientasMCPAgente, Instrucciones, type ServidorConector } from '../../src/permisos.js'
import { largo } from '../../src/validar.js'
import { Sandbox, U } from '../support/sandbox.js'
import { arrancar, llamar, oficina } from '../support/en-proceso.js'

const leerCal = 'mcp__claude_ai_Google_Calendar__list_events'
const verCal = 'mcp__claude_ai_Google_Calendar__get_event'
const crearCal = 'mcp__claude_ai_Google_Calendar__create_event'
const leerMail = 'mcp__claude_ai_Gmail__search_threads'
const enviarMail = 'mcp__claude_ai_Gmail__send_message'

const con = (servidor: string, leer: string[] = [], actuar: string[] = []): ConectorAsignado => ({ servidor, leer, actuar })

const agente = (p: { conectores?: ConectorAsignado[]; limites?: AgenteDef['limites']; permisos?: string[] } = {}): AgenteDef =>
  ({ id: 'sofia', nombre: 'Sofía', rol: 'Directora', departamento: 'dir', ...p })

const oficinaDe = (duenio = 'Ana', reglas?: Oficina['reglas']): Oficina =>
  ({ version: 1, nombre: 'O', duenio, departamentos: [{ id: 'dir', nombre: 'Dir', color: '#aabbcc' }], agentes: [], reglas })

const catalogo: ServidorConector[] = [
  { nombre: 'Google Calendar', prefijo: 'mcp__claude_ai_Google_Calendar', estado: 'connected', herramientas: [leerCal, verCal, crearCal] },
  { nombre: 'Gmail', prefijo: 'mcp__claude_ai_Gmail', estado: 'connected', herramientas: [leerMail, enviarMail] },
]

describe('Instrucciones', () => {
  test('arma reglas, límites, conectores y coordinador', () => {
    const o = oficinaDe('Ana', [{ id: 'a', texto: 'No inventes datos.' }, { id: 'b', texto: 'Citá la fuente.' }])
    const a = agente({
      conectores: [con('Google Calendar', [leerCal, verCal], [crearCal]), con('Gmail', [], [enviarMail])],
      limites: { solo: ['Diseñar fichas'], proponer: ['Cambiar el plan'] }, permisos: ['coordinador'],
    })
    const t = Instrucciones.para(o, a)!
    expect(t).toBeDefined()
    expect(t).toContain('## Reglas de la oficina\n- No inventes datos.\n- Citá la fuente.')
    expect(t).toContain('## Tus límites')
    expect(t).toContain('Hacés solo: Diseñar fichas.')
    expect(t).toContain('Dejás como propuesta y esperás la aprobación de Ana: Cambiar el plan.')
    expect(t).toContain('Nunca hacés directo nada que salga de la oficina')
    expect(t).toContain('## Conectores')
    expect(t).toContain('Podés leer con: Google Calendar (list_events, get_event).')
    expect(t).toContain('Para actuar con Google Calendar (create_event); Gmail (send_message) usá la herramienta proponer_accion: Ana la aprueba')
    expect(t).toContain('## Sos coordinador/a de la oficina')
    expect(t).toContain('estado_oficina, entregas, corridas, bloqueos')
  })

  test('undefined si no hay nada; sin dueño dice «la persona»; la frase de salida va con límites, actuar o reglas', () => {
    expect(Instrucciones.para(oficinaDe(), agente())).toBeUndefined()
    // con el servidor MCP de la oficina, siempre va el párrafo de cómo pedirle algo a un colega
    const mcp = Instrucciones.para(oficinaDe(), agente(), { conMCP: true })!
    expect(mcp).toContain('## Si te falta algo de un colega')
    expect(mcp).toContain('pedíselo con pedir')
    expect(mcp).toContain('quedo_esperando')
    // solo leer: ni límites ni frase de salida
    const leer = Instrucciones.para(oficinaDe(), agente({ conectores: [con('G', [leerCal])] }))!
    expect(leer).toContain('## Conectores')
    expect(leer).not.toContain('## Tus límites')
    // solo reglas: lleva la frase
    const r = Instrucciones.para(oficinaDe('Ana', [{ id: 'a', texto: 'Sé breve.' }]), agente())!
    expect(r).toContain('Nunca hacés directo nada que salga de la oficina')
    // actuar sin dueño
    const sd = Instrucciones.para(oficinaDe(''), agente({ conectores: [con('G', [], [crearCal])] }))!
    expect(sd).toContain('proponer_accion: la persona la aprueba')
    expect(sd).not.toContain('Podés leer con')
  })

  test('en la app (chat, tareas, reuniones) se le cuenta qué puede mostrar; a un colega no', () => {
    const chat = Instrucciones.para(oficinaDe(), agente(), { conMCP: true })!
    expect(chat).toContain('## Cómo se ve lo que respondés')
    expect(chat).toContain('```html, ```svg o ```mermaid')
    expect(chat).toContain('![descripción](ruta)')
    expect(Instrucciones.para(oficinaDe(), agente(), { enApp: true })).toBe(Instrucciones.vistaEnApp)
    expect(Instrucciones.para(oficinaDe(), agente())).toBeUndefined()   // consulta entre colegas
  })

  test('tope de 8000 caracteres', () => {
    const reglas = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, texto: 'x'.repeat(590) }))
    const t = Instrucciones.para(oficinaDe('Ana', reglas), agente())!
    expect(largo(t)).toBe(8000)
  })
})

describe('Conectores', () => {
  test('parsearInit: servidores de claude.ai, su prefijo y sus herramientas', () => {
    const l = '{"type":"system","subtype":"init","mcp_servers":[{"name":"claude.ai Google Calendar","status":"connected","source":"claudeai"},{"name":"claude.ai Gmail","status":"needs-auth","source":"claudeai"},{"name":"hq","status":"connected","source":"project"}],"tools":["Read","mcp__claude_ai_Google_Calendar__list_events","mcp__claude_ai_Google_Calendar__create_event","mcp__hq__colegas"]}'
    const s = Conectores.parsearInit(l)!
    expect(s.map((x) => x.nombre)).toEqual(['Google Calendar', 'Gmail'])
    expect(s[0]!.prefijo).toBe('mcp__claude_ai_Google_Calendar')
    expect(s[0]!.estado).toBe('connected')
    expect(s[0]!.herramientas).toEqual([leerCal, crearCal])
    expect(s[1]!.estado).toBe('needs-auth')
    expect(s[1]!.herramientas).toEqual([])
    expect(Conectores.parsearInit('{"type":"result","result":"ok"}')).toBeUndefined()
    expect(Conectores.parsearInit('no es json')).toBeUndefined()
    expect(Conectores.parsearInit('{"type":"system","subtype":"init"}')).toEqual([])
  })

  test('prefijo: lo que no es letra, número, _ o - pasa a _', () => {
    expect(Conectores.prefijo('Google Calendar')).toBe('mcp__claude_ai_Google_Calendar')
    expect(Conectores.prefijo('Notion/Docs.v2')).toBe('mcp__claude_ai_Notion_Docs_v2')
  })

  test('clasificar: leer por prefijo (también camelCase), actuar si hay duda', () => {
    for (const l of ['list_events', 'get_event', 'search_threads', 'read_file_content', 'find_duplicates', 'fetch', 'download_file_content',
      'query', 'lookup_user', 'suggest_time', 'listEvents', 'getThread', 'searchConfluenceUsingCql', 'LookupJiraAccountId']) {
      expect(Conectores.clasificar(l), l).toBe('leer')
    }
    for (const l of ['create_event', 'send_message', 'trash_file', 'update_values', 'delete_draft', 'share_file', 'forward', 'createDraft', 'algo_raro']) {
      expect(Conectores.clasificar(l), l).toBe('actuar')
    }
    expect(Conectores.corto('mcp__claude_ai_Gmail__send_message')).toBe('send_message')
  })

  test('el catálogo guarda, limpia y lanza la detección inicial una sola vez', () => {
    const c = new CatalogoConectores()
    expect(c.servidores()).toBeUndefined()
    expect(c.detectado()).toBeUndefined()
    expect(c.pedirDeteccionInicial()).toBe(true)
    expect(c.detectando).toBe(true)
    expect(c.pedirDeteccionInicial()).toBe(false)
    expect(c.empezarDeteccion()).toBe(false)
    c.terminarDeteccion()
    expect(c.detectando).toBe(false)
    expect(c.pedirDeteccionInicial()).toBe(false) // ya se intentó
    c.fijar(catalogo)
    expect(c.servidores()).toEqual(catalogo)
    expect(c.detectado()).toBeInstanceOf(Date)
    c.limpiar()
    expect(c.servidores()).toBeUndefined()
    expect(c.pedirDeteccionInicial()).toBe(true)
  })
})

describe('ConectoresAgente', () => {
  test('veda create_event y Gmail; pedir actuar habilita create_event', () => {
    const a = agente({ conectores: [con('Google Calendar', [leerCal, verCal], [crearCal])] })
    const { permitidas: p, vedadas: v } = ConectoresAgente.herramientas(oficinaDe(), a, catalogo, [])
    expect(p).toEqual([leerCal, verCal])
    expect(new Set(v)).toEqual(new Set([crearCal, 'mcp__claude_ai_Gmail']))
    const r2 = ConectoresAgente.herramientas(oficinaDe(), a, catalogo, [crearCal])
    expect(r2.permitidas).toEqual([leerCal, verCal, crearCal])
    expect(r2.vedadas).toEqual(['mcp__claude_ai_Gmail'])
    // pedir actuar algo que no tiene asignado no sirve
    const r3 = ConectoresAgente.herramientas(oficinaDe(), a, catalogo, [enviarMail])
    expect(r3.permitidas).not.toContain(enviarMail)
  })

  test('sin catálogo no veda nada; sin permitidas veda todos los conectores', () => {
    const a = agente({ conectores: [con('Google Calendar', [leerCal])] })
    const r = ConectoresAgente.herramientas(oficinaDe(), a, undefined, [])
    expect(r.permitidas).toEqual([leerCal])
    expect(r.vedadas).toEqual([])
    for (const ag of [agente(), agente({ conectores: [con('Gmail', [], [enviarMail])] })]) {
      const x = ConectoresAgente.herramientas(oficinaDe(), ag, catalogo, [])
      expect(x.permitidas).toEqual([])
      expect(x.vedadas).toEqual(['mcp__claude_ai_*'])
    }
    const s0 = ConectoresAgente.herramientas(oficinaDe(), agente(), undefined, [])
    expect(s0.permitidas).toEqual([])
    expect(s0.vedadas).toEqual(['mcp__claude_ai_*'])
  })
})

describe('Acciones (en proceso)', () => {
  async function preparar() {
    const sb = new Sandbox()
    const b = arrancar(sb)
    const carpeta = await oficina(b, ['marce', 'nico'])
    const r = await llamar(b, 'PATCH', '/api/agentes/marce', { conectores: [{ servidor: 'Google Calendar', leer: [leerCal, verCal], actuar: [crearCal] }] })
    expect(r.status).toBe(200)
    return { sb, b, s: b.servicios, carpeta }
  }
  const nombres = (h: { definiciones: Record<string, unknown>[] }) => h.definiciones.map((d) => d.name)

  test('herramientas MCP: solo con herramientas de actuar asignadas', async () => {
    const { s, carpeta } = await preparar()
    const act = s.oficinas.activa()!
    const marce = act.oficina.agentes.find((a) => a.id === 'marce')!
    const nico = act.oficina.agentes.find((a) => a.id === 'nico')!
    expect(Acciones.herramientasMCP(act.oficina, marce)).toEqual(['mcp__hq__proponer_accion'])
    expect(Acciones.herramientasMCP(act.oficina, nico)).toEqual([])
    expect(HerramientasMCPAgente.lista(act.oficina, marce)).toContain('mcp__hq__proponer_accion')
    expect(HerramientasMCPAgente.lista(act.oficina, nico)).not.toContain('mcp__hq__proponer_accion')
    const mcp = mcpDe(s)!
    const id = (a: string) => ({ oficina: carpeta, agente: a, sid: U.a, perfil: 'agente' })
    expect(nombres(mcp.consultas.herramientas('t', id('marce')))).toEqual(['colegas', 'consultar', 'quien_sabe', 'buscar', 'marcar_obsoleto', 'anotar', 'seguimiento', 'seguimientos', 'seguimiento_leer', 'ficha_anotar', 'ficha_leer', 'proponer_accion', 'pedir', 'quedo_esperando', 'cancelar_espera'])
    expect(nombres(mcp.consultas.herramientas('t', id('nico')))).toEqual(['colegas', 'consultar', 'quien_sabe', 'buscar', 'marcar_obsoleto', 'anotar', 'seguimiento', 'seguimientos', 'seguimiento_leer', 'ficha_anotar', 'ficha_leer', 'pedir', 'quedo_esperando', 'cancelar_espera'])
    // y sin asignación nico no puede proponer aunque llame por nombre
    expect(await mcp.consultas.herramientas('t', id('nico')).llamar('proponer_accion', { herramienta: crearCal, resumen: 'x' })).toBeUndefined()
  })

  test('proponer_accion: guarda la acción vinculada a su entrega y rechaza lo que no corresponde', async () => {
    const { s, carpeta } = await preparar()
    const mcp = mcpDe(s)!
    const ident = { oficina: carpeta, agente: 'marce', sid: U.a, perfil: 'agente' }
    const token = mcp.tokens.emitir(ident)
    const h = mcp.consultas.herramientas(token, ident)
    const r = (await h.llamar('proponer_accion', { herramienta: crearCal, resumen: 'Crear la reunión', detalle: { titulo: 'Reunión', n: 2 } }))!
    expect(r.esError, r.texto).toBe(false)
    expect(r.texto).toContain('Propuesta #1 guardada: Ana la revisa')
    const e = s.entregas.lista(carpeta, { origen: 'propuesta' })[0]!
    expect(e.titulo).toBe('Propuesta: Crear la reunión')
    expect(e.texto).toBe('Crear la reunión\n\nHerramienta: create_event\nn: 2\ntitulo: Reunión')
    const a = accionesDe(s).porEntrega(carpeta, e.id)!
    expect(a.estado).toBe('pendiente')
    expect(a.detalle).toBe('{"n":2,"titulo":"Reunión"}')
    expect(a.entrega).toBe(e.id)
    // errores
    for (const args of [{ herramienta: enviarMail, resumen: 'x' }, { herramienta: crearCal, resumen: '  ' }, { herramienta: crearCal, resumen: 'x', detalle: 'no json' }]) {
      expect((await h.llamar('proponer_accion', args))!.esError).toBe(true)
    }
    expect(s.entregas.lista(carpeta, { origen: 'propuesta' }).length).toBe(1)
  })

  test('proponer_accion: guarda de dónde salió y lo que comprobó, y se listan por sesión', async () => {
    const { s, b, carpeta } = await preparar()
    const mcp = mcpDe(s)!
    const ident = { oficina: carpeta, agente: 'marce', sid: U.a, perfil: 'agente' }
    const h = mcp.consultas.herramientas(mcp.tokens.emitir(ident), ident)
    const r = (await h.llamar('proponer_accion', {
      herramienta: crearCal, resumen: 'Agendar el turno', detalle: { summary: 'Cardiólogo' },
      origen: { de: ' Mamá ', por: 'WhatsApp', cuando: 'hoy 9:41', cita: 'el jueves   a las 10', otra: 'x', n: 3 },
      nota: 'Miré tu calendario: está libre.',
    }))!
    expect(r.esError, r.texto).toBe(false)
    await h.llamar('proponer_accion', { herramienta: crearCal, resumen: 'Otra', origen: { de: '' } })
    const [a1, a2] = accionesDe(s).porSid(carpeta, U.a)
    expect(a1!.origen).toBe('{"cita":"el jueves a las 10","cuando":"hoy 9:41","de":"Mamá","por":"WhatsApp"}')
    expect(a1!.nota).toBe('Miré tu calendario: está libre.')
    expect(a2!.origen).toBeUndefined()
    expect(a2!.nota).toBeUndefined()
    const l = await llamar(b, 'GET', '/api/acciones', undefined, { sid: U.a })
    expect(l.status).toBe(200)
    const acs = l.obj.acciones as Record<string, unknown>[]
    expect(acs.map((x) => x.resumen)).toEqual(['Agendar el turno', 'Otra'])
    expect(acs[0]!.origen).toEqual({ de: 'Mamá', por: 'WhatsApp', cuando: 'hoy 9:41', cita: 'el jueves a las 10' })
    expect(acs[1]!.origen).toBeNull()
    expect(((await llamar(b, 'GET', '/api/acciones', undefined, { sid: 'otra' })).obj.acciones as unknown[]).length).toBe(0)
  })

  test('detalleJSON y legible', () => {
    expect(Acciones.detalleJSON(undefined)).toBe('{}')
    expect(Acciones.detalleJSON(null)).toBe('{}')
    expect(Acciones.detalleJSON('{"b":1,"a":"x"}')).toBe('{"a":"x","b":1}')
    expect(Acciones.detalleJSON('nada')).toBeUndefined()
    expect(Acciones.detalleJSON([1])).toBeUndefined()
    expect(Acciones.detalleJSON({ t: 'x'.repeat(8000) })).toBeUndefined()
    expect(Acciones.legible('{}')).toBe('Sin argumentos.')
    expect(Acciones.legible('{"b":[1,2],"a":"x"}')).toBe('a: x\nb: [1,2]')
  })

  test('una entrega «suelta» (sin acción) da 404 en ejecutar y descartar-accion', async () => {
    const { s, b, carpeta } = await preparar()
    const suelta = s.entregas.crear({ oficina: carpeta, agente: 'marce', origen: 'tarea', ref: 'x', titulo: 'T', texto: 't' })!
    const ej = await llamar(b, 'POST', `/api/entregas/${suelta.id}/ejecutar`)
    expect(ej.status).toBe(404)
    expect(ej.obj.error).toContain('acción')
    expect((await llamar(b, 'POST', `/api/entregas/${suelta.id}/descartar-accion`)).status).toBe(404)
  })

  test('el catálogo del backend lo llena la detección y lo leen los chats (s.catalogo)', async () => {
    const { s } = await preparar()
    expect(s.catalogo?.()).toBeUndefined()
    catalogoDe(s)!.fijar(catalogo)
    expect(s.catalogo?.()).toEqual(catalogo)
  })
})
